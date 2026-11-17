import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { PluginError, throwIfAborted } from './errors.js'

export function parseChecksums(text) {
  const result = new Map()
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (match) result.set(match[2].trim(), match[1].toLowerCase())
  }
  return result
}

async function fetchWithRedirects(url, { signal, maxRedirects = 5 } = {}) {
  let current = new URL(url)
  for (let index = 0; index <= maxRedirects; index += 1) {
    throwIfAborted(signal)
    if (current.protocol !== 'https:') {
      throw new PluginError('INSECURE_URL', `Only HTTPS downloads are allowed: ${current}`)
    }
    const response = await fetch(current, { redirect: 'manual', signal })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new PluginError('DOWNLOAD_FAILED', `Redirect without Location: ${current}`)
      current = new URL(location, current)
      continue
    }
    if (!response.ok) {
      throw new PluginError('DOWNLOAD_FAILED', `Download returned HTTP ${response.status}: ${current}`)
    }
    return response
  }
  throw new PluginError('DOWNLOAD_FAILED', `Too many redirects: ${url}`)
}

async function downloadToFile(url, destination, { signal, maxBytes }) {
  const response = await fetchWithRedirects(url, { signal })
  const length = Number(response.headers.get('content-length') || 0)
  if (length && maxBytes && length > maxBytes) {
    throw new PluginError('DOWNLOAD_TOO_LARGE', `Download is too large: ${length} bytes`)
  }

  const temporary = `${destination}.part-${process.pid}-${Date.now()}`
  await mkdir(path.dirname(destination), { recursive: true })
  try {
    const source = Readable.fromWeb(response.body)
    let total = 0
    source.on('data', (chunk) => {
      total += chunk.length
      if (maxBytes && total > maxBytes) source.destroy(new PluginError('DOWNLOAD_TOO_LARGE', 'Download exceeded size limit'))
    })
    await pipeline(source, createWriteStream(temporary))
    return { temporary, bytes: total, response }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function downloadVerified(
  url,
  destination,
  { expectedSha256, checksumsUrl, signal, maxBytes = 200 * 1024 * 1024 } = {},
) {
  throwIfAborted(signal)
  let expected = expectedSha256 ? String(expectedSha256).toLowerCase() : undefined
  if (!expected) {
    if (!checksumsUrl) throw new PluginError('CHECKSUM_MISSING', 'No checksum is available for this download')
    const response = await fetchWithRedirects(checksumsUrl, { signal })
    const checksums = parseChecksums(await response.text())
    expected = checksums.get(path.basename(new URL(url).pathname))
    if (!expected) throw new PluginError('CHECKSUM_MISSING', `No checksum found for ${path.basename(url)}`)
  }

  const { temporary, bytes } = await downloadToFile(url, destination, { signal, maxBytes })
  try {
    const hash = createHash('sha256')
    const handle = await import('node:fs/promises').then(({ open }) => open(temporary, 'r'))
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      let position = 0
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (bytesRead === 0) break
        hash.update(buffer.subarray(0, bytesRead))
        position += bytesRead
        throwIfAborted(signal)
      }
    } finally {
      await handle.close()
    }
    const actual = hash.digest('hex')
    if (actual !== expected) {
      throw new PluginError('CHECKSUM_MISMATCH', `Checksum mismatch for ${path.basename(destination)}`, {
        expected,
        actual,
      })
    }
    await rename(temporary, destination)
    return { sha256: actual, bytes }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function fileExists(file) {
  try {
    const info = await stat(file)
    return info.isFile()
  } catch {
    return false
  }
}
