import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { PluginError, throwIfAborted } from './errors.js'

const LATEST_API = 'https://api.ugnas.com/api/system/v1/sa/unc/releases/latest'
const DEFAULT_DOWNLOAD_BASE = 'https://file1-cn.ugnas.com/nas-cli'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

let pinnedManifestPromise

async function loadPinnedManifest() {
  pinnedManifestPromise ??= readFile(new URL('../assets/pinned-manifest.json', import.meta.url), 'utf8')
    .then((text) => JSON.parse(text))
  return pinnedManifestPromise
}

function normalizeBase(base) {
  return String(base || DEFAULT_DOWNLOAD_BASE).replace(/\/+$/, '')
}

function validateRelease(release) {
  if (!release || typeof release !== 'object') throw new PluginError('RELEASE_INVALID', 'Release metadata is invalid')
  if (typeof release.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(release.version)) {
    throw new PluginError('RELEASE_INVALID', 'Release version is not a stable semantic version', release)
  }
  if (!Array.isArray(release.assets) || release.assets.length === 0) {
    throw new PluginError('RELEASE_INVALID', 'Release has no assets', release)
  }
  return release
}

async function buildPinnedRelease({ pinnedVersion, downloadBase }) {
  const manifest = await loadPinnedManifest()
  const requested = String(pinnedVersion || manifest.version).replace(/^v/, '')
  if (requested !== manifest.version) {
    throw new PluginError(
      'UNSUPPORTED_VERSION',
      `Pinned version ${requested} is not bundled; supported pinned version is ${manifest.version}`,
    )
  }

  const tag = `v${manifest.version}`
  const base = normalizeBase(downloadBase || manifest.downloadBase)
  const assets = Object.values(manifest.assets)
  return {
    version: manifest.version,
    tag,
    assets,
    checksums: { ...manifest.checksums },
    checksumsUrl: `${base}/${tag}/checksums.txt`,
    downloadBase: base,
    skillsAsset: manifest.skillsAsset,
    source: 'pinned',
  }
}

async function fetchLatestRelease({ signal }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Release request timed out')), 15_000)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    throwIfAborted(signal)
    const response = await fetch(LATEST_API, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new PluginError('RELEASE_UNAVAILABLE', `Release API returned HTTP ${response.status}`)
    }
    const body = await response.json()
    const release = validateRelease({
      version: String(body.version || String(body.tag || '').replace(/^v/, '')),
      tag: String(body.tag || `v${body.version || ''}`),
      assets: body.assets,
      source: 'latest',
    })
    if (release.tag !== `v${release.version}`) {
      throw new PluginError('RELEASE_INVALID', 'Release tag and version disagree', body)
    }
    return release
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function readCache(cacheDir, cacheTtlMs = CACHE_TTL_MS, downloadBase = DEFAULT_DOWNLOAD_BASE) {
  if (!cacheDir) return undefined
  try {
    const raw = await readFile(path.join(cacheDir, 'release-cache.json'), 'utf8')
    const cached = JSON.parse(raw)
    if (!cached?.release || Date.now() - Number(cached.fetchedAt) > cacheTtlMs) return undefined
    const release = validateRelease(cached.release)
    const base = normalizeBase(downloadBase)
    return {
      ...release,
      downloadBase: base,
      checksumsUrl: `${base}/${release.tag}/checksums.txt`,
      skillsAsset: release.skillsAsset || `unc-skills-${release.tag}.zip`,
    }
  } catch {
    return undefined
  }
}

async function writeCache(cacheDir, release) {
  if (!cacheDir) return
  await mkdir(cacheDir, { recursive: true })
  const target = path.join(cacheDir, 'release-cache.json')
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, JSON.stringify({ fetchedAt: Date.now(), release }, null, 2), 'utf8')
  await rename(temporary, target)
}

export async function resolveRelease({
  versionPolicy = 'latest',
  pinnedVersion = '0.1.61',
  downloadBase = DEFAULT_DOWNLOAD_BASE,
  cacheDir,
  cacheTtlMs = CACHE_TTL_MS,
  signal,
} = {}) {
  if (versionPolicy !== 'latest' && versionPolicy !== 'pinned') {
    throw new PluginError('CONFIG_INVALID', `Unknown versionPolicy: ${versionPolicy}`)
  }

  if (versionPolicy === 'pinned') {
    const release = await buildPinnedRelease({ pinnedVersion, downloadBase })
    return release
  }

  const cached = await readCache(cacheDir, cacheTtlMs, downloadBase)
  if (cached) return { ...cached, downloadBase: normalizeBase(downloadBase || DEFAULT_DOWNLOAD_BASE) }

  try {
    const latest = await fetchLatestRelease({ signal })
    const release = {
      ...latest,
      downloadBase: normalizeBase(downloadBase || DEFAULT_DOWNLOAD_BASE),
      checksumsUrl: `${normalizeBase(downloadBase || DEFAULT_DOWNLOAD_BASE)}/${latest.tag}/checksums.txt`,
      skillsAsset: `unc-skills-${latest.tag}.zip`,
    }
    await writeCache(cacheDir, release)
    return release
  } catch (error) {
    if (signal?.aborted) throw error
    const pinned = await buildPinnedRelease({ pinnedVersion, downloadBase })
    return { ...pinned, fallbackReason: error instanceof Error ? error.message : String(error) }
  }
}

export { LATEST_API, DEFAULT_DOWNLOAD_BASE }
