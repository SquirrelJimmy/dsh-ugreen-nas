import { readFile } from 'node:fs/promises'

const ENV_FILE = new URL('../.env', import.meta.url)

function stripQuotes(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

export function parseEnv(text) {
  const result = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    result[match[1]] = stripQuotes(match[2].trim())
  }
  return result
}

export async function readProjectEnv() {
  try {
    return parseEnv(await readFile(ENV_FILE, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

export async function loginDefaults() {
  const env = await readProjectEnv()
  const host = process.env.UGREEN_NAS_HOST || env.UGREEN_NAS_HOST || env.HOST || ''
  const linkId =
    process.env.UGREEN_NAS_LINK_ID || env.UGREEN_NAS_LINK_ID || env.LINK_ID || ''
  const requestedMode =
    process.env.UGREEN_NAS_LOGIN_MODE || env.UGREEN_NAS_LOGIN_MODE || env.LOGIN_MODE || ''
  const mode =
    requestedMode === 'linkid' || requestedMode === 'link-id' || requestedMode === 'uglink'
      ? 'linkid'
      : requestedMode === 'ddns' || requestedMode === 'host'
        ? 'ddns'
        : linkId && !host
          ? 'linkid'
          : 'ddns'
  return {
    mode,
    host,
    linkId,
    hasToken: Boolean(
      process.env.UGREEN_NAS_TOKEN || env.UGREEN_NAS_TOKEN || env.AUTH_TOKEN,
    ),
  }
}

export async function resolveLoginInput({ mode, host, linkId, token } = {}) {
  const env = await readProjectEnv()
  const candidateHost = String(
    host || process.env.UGREEN_NAS_HOST || env.UGREEN_NAS_HOST || env.HOST || '',
  ).trim()
  const candidateLinkId = String(
    linkId ||
      process.env.UGREEN_NAS_LINK_ID ||
      env.UGREEN_NAS_LINK_ID ||
      env.LINK_ID ||
      '',
  ).trim()
  const requestedMode = String(
    mode ||
      process.env.UGREEN_NAS_LOGIN_MODE ||
      env.UGREEN_NAS_LOGIN_MODE ||
      env.LOGIN_MODE ||
      '',
  )
    .trim()
    .toLowerCase()
  const resolvedMode =
    requestedMode === 'linkid' || requestedMode === 'link-id' || requestedMode === 'uglink'
      ? 'linkid'
      : requestedMode === 'ddns' || requestedMode === 'host'
        ? 'ddns'
        : candidateLinkId && !candidateHost
          ? 'linkid'
          : 'ddns'
  return {
    mode: resolvedMode,
    host: resolvedMode === 'ddns' ? candidateHost : '',
    linkId: resolvedMode === 'linkid' ? candidateLinkId : '',
    token: String(
      token || process.env.UGREEN_NAS_TOKEN || env.UGREEN_NAS_TOKEN || env.AUTH_TOKEN || '',
    ).trim(),
  }
}
