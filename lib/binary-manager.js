import { execFile } from 'node:child_process'
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { extractArchive, extractSkillArchive } from './archive.js'
import { downloadVerified, fileExists } from './download.js'
import { PluginError, throwIfAborted } from './errors.js'
import { detectPlatform, artifactName } from './platform.js'
import { resolveRelease } from './release.js'

const execFileAsync = promisify(execFile)

async function verifyBinary(binaryPath) {
  try {
    const { stdout } = await execFileAsync(binaryPath, ['version', '--format', 'json'], {
      timeout: 15_000,
      windowsHide: true,
    })
    const data = JSON.parse(stdout)
    if (!data?.version) throw new Error('version field missing')
    return data.version
  } catch (error) {
    throw new PluginError('BINARY_VERIFY_FAILED', `Downloaded binary failed verification: ${error.message}`)
  }
}

function nowIso() {
  return new Date().toISOString()
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

function isPathInside(root, target) {
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  await import('node:fs/promises').then(({ writeFile }) => writeFile(temporary, JSON.stringify(value, null, 2), 'utf8'))
  await rename(temporary, file)
}

export class BinaryManager {
  constructor({
    stateDir,
    versionPolicy = 'latest',
    pinnedVersion = '0.1.61',
    downloadBase,
    autoCheckHours = 24,
    installSkills = true,
  }) {
    if (!stateDir) throw new PluginError('CONFIG_INVALID', 'stateDir is required')
    this.stateDir = stateDir
    this.versionPolicy = versionPolicy
    this.pinnedVersion = pinnedVersion
    this.downloadBase = downloadBase
    this.autoCheckHours = autoCheckHours
    this.installSkills = installSkills
    this.currentFile = path.join(stateDir, 'current.json')
    this.lockFile = path.join(stateDir, 'install.lock')
  }

  async getCurrent() {
    const current = await readJson(this.currentFile)
    const binaryPath = current?.binaryPath || current?.binary
    if (!current || typeof binaryPath !== 'string' || !isPathInside(this.stateDir, binaryPath)) return undefined
    if (!(await fileExists(binaryPath))) return undefined
    let platform
    try {
      platform = detectPlatform()
    } catch {
      return undefined
    }
    if (current.platform && current.platform !== platform.platformName) return undefined
    return { ...current, binaryPath }
  }

  async getPath() {
    const current = await this.getCurrent()
    if (!current) {
      throw new PluginError('BINARY_NOT_INSTALLED', 'The unc binary is not installed', {
        hint: 'Run ugreen_nas_setup with action=install',
      })
    }
    return current.binaryPath
  }

  async status() {
    let current
    try {
      current = await this.getCurrent()
    } catch (error) {
      if (error?.code !== 'BINARY_NOT_INSTALLED') throw error
    }
    const platformInfo = detectPlatform()
    return {
      installed: Boolean(current),
      ...(current
        ? {
            version: current.version,
            path: current.binaryPath,
            sha256: current.sha256,
            source: current.source,
            installedAt: current.installedAt,
            skillsPath: current.skillsPath,
          }
        : {}),
      platform: platformInfo.platformName,
      versionPolicy: this.versionPolicy,
    }
  }

  async checkLatest() {
    const current = await this.getCurrent()
    try {
      const release = await resolveRelease({
        versionPolicy: 'latest',
        pinnedVersion: this.pinnedVersion,
        downloadBase: this.downloadBase,
        cacheDir: this.stateDir,
        cacheTtlMs: this.autoCheckHours * 60 * 60 * 1000,
      })
      return {
        currentVersion: current?.version,
        latestVersion: release.version,
        updateAvailable: Boolean(current && current.version !== release.version),
        source: release.source,
      }
    } catch (error) {
      return {
        currentVersion: current?.version,
        latestVersion: undefined,
        updateAvailable: undefined,
        errorCode: error?.code || 'RELEASE_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async withLock(fn) {
    await mkdir(this.stateDir, { recursive: true })
    let handle
    try {
      handle = await open(this.lockFile, 'wx')
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const info = await stat(this.lockFile).catch(() => undefined)
        if (info && Date.now() - info.mtimeMs > 15 * 60 * 1000) {
          await rm(this.lockFile, { force: true })
          return this.withLock(fn)
        }
        throw new PluginError('INSTALL_IN_PROGRESS', 'Another install is already running', {
          lockFile: this.lockFile,
        })
      }
      throw error
    }
    try {
      return await fn()
    } finally {
      await handle.close().catch(() => {})
      await rm(this.lockFile, { force: true }).catch(() => {})
    }
  }

  async install({ versionPolicy = this.versionPolicy, pinnedVersion = this.pinnedVersion, force = false, signal } = {}) {
    return this.withLock(async () => {
      throwIfAborted(signal)
      const platformInfo = detectPlatform()
      const release = await resolveRelease({
        versionPolicy,
        pinnedVersion,
        downloadBase: this.downloadBase,
        cacheDir: this.stateDir,
        cacheTtlMs: this.autoCheckHours * 60 * 60 * 1000,
        signal,
      })
      const assetName = artifactName(platformInfo, release.version)
      if (!release.assets.includes(assetName)) {
        throw new PluginError('ASSET_NOT_FOUND', `Release ${release.version} does not publish ${assetName}`)
      }

      const versionDir = path.join(this.stateDir, 'versions', release.version)
      const finalBinary = path.join(versionDir, platformInfo.binaryName)
      const finalSkills = path.join(versionDir, 'skill')
      const existing = await this.getCurrent()
      if (!force && existing?.version === release.version && existing.binaryPath === finalBinary) {
        return { ...existing, alreadyInstalled: true }
      }

      const temporaryRoot = path.join(this.stateDir, 'tmp', `install-${process.pid}-${Date.now()}`)
      const archivePath = path.join(temporaryRoot, assetName)
      const extractedRoot = path.join(temporaryRoot, 'binary')
      await mkdir(extractedRoot, { recursive: true })

      try {
        const assetUrl = `${release.downloadBase}/${release.tag}/${assetName}`
        const checksum = release.checksums?.[assetName]
        await downloadVerified(assetUrl, archivePath, {
          expectedSha256: checksum,
          checksumsUrl: release.checksumsUrl,
          signal,
        })
        const extractedBinary = await extractArchive({
          archivePath,
          destination: extractedRoot,
          binaryName: platformInfo.binaryName,
          signal,
        })
        await chmod(extractedBinary, 0o755)
        await verifyBinary(extractedBinary)

        await mkdir(versionDir, { recursive: true })
        await rm(finalBinary, { force: true })
        await rename(extractedBinary, finalBinary)

        let skillsPath
        let skillError
        if (this.installSkills && release.skillsAsset) {
          const skillsArchive = path.join(temporaryRoot, release.skillsAsset)
          try {
            await downloadVerified(`${release.downloadBase}/${release.tag}/${release.skillsAsset}`, skillsArchive, {
              expectedSha256: release.checksums?.[release.skillsAsset],
              checksumsUrl: release.checksumsUrl,
              signal,
            })
            const extractedSkill = await extractSkillArchive({
              archivePath: skillsArchive,
              destination: path.join(temporaryRoot, 'skills'),
              signal,
            })
            await rm(finalSkills, { recursive: true, force: true })
            await rename(extractedSkill, finalSkills)
            skillsPath = finalSkills
          } catch (error) {
            if (signal?.aborted) throw error
            skillError = error instanceof Error ? error.message : String(error)
          }
        }

        const current = {
          version: release.version,
          tag: release.tag,
          platform: platformInfo.platformName,
          binaryPath: finalBinary,
          binary: finalBinary,
          path: finalBinary,
          previousVersion: existing?.version ?? null,
          sha256: checksum,
          source: release.source,
          installedAt: nowIso(),
          ...(skillsPath ? { skillsPath } : {}),
          ...(skillError ? { skillError } : {}),
        }
        await writeJsonAtomic(this.currentFile, current)
        return { ...current, alreadyInstalled: false, ...(release.fallbackReason ? { fallbackReason: release.fallbackReason } : {}) }
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
      }
    })
  }

  async cleanup({ keepVersions = 2 } = {}) {
    const versionsDir = path.join(this.stateDir, 'versions')
    const entries = await import('node:fs/promises').then(({ readdir }) => readdir(versionsDir, { withFileTypes: true })).catch(() => [])
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    const remove = directories.slice(0, Math.max(0, directories.length - keepVersions))
    for (const version of remove) await rm(path.join(versionsDir, version), { recursive: true, force: true })
    return { removed: remove }
  }
}
