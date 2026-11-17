import { createWriteStream } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import * as tar from 'tar'
import yauzl from 'yauzl'

import { PluginError, throwIfAborted } from './errors.js'

export function isSafeRelativePath(entryName) {
  const normalized = String(entryName).replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false
  const parts = normalized.split('/')
  return parts.every((part) => part !== '..' && part !== '')
}

function assertSafe(entryName) {
  if (!isSafeRelativePath(entryName)) {
    throw new PluginError('ARCHIVE_UNSAFE', `Unsafe archive entry: ${entryName}`)
  }
}

async function assertNoSymlinks(root) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isSymbolicLink()) {
      throw new PluginError('ARCHIVE_UNSAFE', `Archive contains a symbolic link: ${entryPath}`)
    }
    if (entry.isDirectory()) await assertNoSymlinks(entryPath)
  }
}

function extractZip(archivePath, destination, signal) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(new PluginError('ARCHIVE_INVALID', `Cannot open zip: ${openError?.message || archivePath}`))
        return
      }

      let settled = false
      const fail = (error) => {
        if (settled) return
        settled = true
        zipFile.close()
        reject(error)
      }
      const onAbort = () => fail(new PluginError('CANCELLED', 'Archive extraction cancelled'))
      signal?.addEventListener('abort', onAbort, { once: true })

      zipFile.on('error', fail)
      zipFile.on('end', () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        resolve()
      })
      zipFile.on('entry', (entry) => {
        try {
          throwIfAborted(signal)
          assertSafe(entry.fileName)
        } catch (error) {
          fail(error)
          return
        }

        const output = path.join(destination, entry.fileName)
        if (/\/$/.test(entry.fileName)) {
          mkdir(output, { recursive: true }).then(() => zipFile.readEntry(), fail)
          return
        }
        zipFile.openReadStream(entry, (streamError, readStream) => {
          if (streamError || !readStream) {
            fail(new PluginError('ARCHIVE_INVALID', `Cannot read zip entry: ${entry.fileName}`))
            return
          }
          mkdir(path.dirname(output), { recursive: true })
            .then(() => pipeline(readStream, createWriteStream(output)))
            .then(() => zipFile.readEntry(), fail)
        })
      })
      zipFile.readEntry()
    })
  })
}

async function extractTar(archivePath, destination, signal) {
  throwIfAborted(signal)
  await tar.x({
    file: archivePath,
    cwd: destination,
    strict: true,
    filter: (entryPath) => {
      throwIfAborted(signal)
      assertSafe(entryPath)
      return true
    },
  })
}

async function findFileRecursive(root, targetName, depth = 0) {
  if (depth > 6) return undefined
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isFile() && entry.name === targetName) return entryPath
    if (entry.isDirectory()) {
      const found = await findFileRecursive(entryPath, targetName, depth + 1)
      if (found) return found
    }
  }
  return undefined
}

export async function extractArchive({ archivePath, destination, binaryName, signal }) {
  await mkdir(destination, { recursive: true })
  if (archivePath.endsWith('.zip')) await extractZip(archivePath, destination, signal)
  else await extractTar(archivePath, destination, signal)
  await assertNoSymlinks(destination)
  const binaryPath = await findFileRecursive(destination, binaryName)
  if (!binaryPath) throw new PluginError('ARCHIVE_INVALID', `Binary ${binaryName} not found in archive`)
  return binaryPath
}

export async function extractSkillArchive({ archivePath, destination, signal }) {
  await mkdir(destination, { recursive: true })
  await extractZip(archivePath, destination, signal)
  await assertNoSymlinks(destination)
  const skillFile = await findFileRecursive(destination, 'SKILL.md')
  if (!skillFile) throw new PluginError('ARCHIVE_INVALID', 'SKILL.md not found in skills archive')
  return path.dirname(skillFile)
}
