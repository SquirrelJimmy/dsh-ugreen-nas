import { PluginError } from './errors.js'

const BLOCKED_GROUPS = new Set(['plugin', 'skill', 'upgrade', 'uninstall', 'completion'])
const BLOCKED_AUTH_ACTIONS = new Set(['login', 'workbuddy', 'export', 'import', 'refresh-host', 'reset'])

const READ_ACTIONS = {
  file: new Set([
    'ls', 'ls-root', 'cat', 'head', 'tail', 'stat', 'search', 'find', 'du', 'download',
    'gen-thumb', 'getfattr', 'md5sum', 'sha256sum', 'quota', 'tag',
  ]),
  docker: new Set(['images', 'ps', 'logs', 'search', 'stats', 'dir-check', 'gpu-check', 'port-check', 'compose']),
  download: new Set(['ls', 'status']),
  storage: new Set(['disk', 'pool', 'volume']),
  app: new Set(['get', 'ls', 'search', 'status']),
  search: new Set(['title', 'results']),
  ctl: new Set(['group', 'hardware', 'os', 'user']),
  network: new Set(['general', 'iface']),
  taskmgr: new Set(['cpu', 'gpu', 'mem', 'net', 'disk', 'service', 'process', 'volume', 'overview']),
  version: new Set(['version']),
  doctor: new Set(['doctor']),
  auth: new Set(['status']),
}

const DESTRUCTIVE_ACTIONS = {
  file: new Set(['rm', 'mv', 'cp', 'mkdir', 'mkdir-share', 'touch', 'tee', 'upload', 'recover-recycle']),
  docker: new Set(['stop', 'restart', 'rebuild', 'pull', 'start']),
  download: new Set(['rm', 'create', 'pause', 'resume', 'retry']),
  app: new Set(['uninstall', 'stop', 'install', 'start', 'update']),
  search: new Set(['cancel', 'rm']),
  auth: new Set(['logout']),
}

const READ_SUBACTIONS = {
  file: {
    quota: new Set(['get']),
    tag: { direct: new Set(['list', 'get', 'filter']), file: new Set(['get', 'list']) },
  },
  ctl: {
    group: new Set(['ls']),
    user: new Set(['ls']),
  },
  docker: {
    compose: new Set(['logs', 'ls']),
  },
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isReadAction(group, action, argv) {
  if (group === 'version' || group === 'doctor') return true
  const sub = READ_SUBACTIONS[group]?.[action]
  if (sub) {
    const value = argv[2]
    if (!value || value.startsWith('-')) return true
    if (sub instanceof Set) return sub.has(value)
    if (value === 'file') return sub.file.has(argv[3])
    return sub.direct.has(value)
  }
  return READ_ACTIONS[group]?.has(action) ?? false
}

function validateArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new PluginError('INVALID_ARGV', 'argv must be a non-empty string array')
  }
  if (argv.length > 64) throw new PluginError('INVALID_ARGV', 'argv has too many arguments')
  for (const item of argv) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 2048) {
      throw new PluginError('INVALID_ARGV', 'Each argv item must be a non-empty string of at most 2048 characters')
    }
    if (item.includes('\0') || /[\r\n]/.test(item)) {
      throw new PluginError('INVALID_ARGV', 'argv must not contain NUL or newline characters')
    }
  }
}

export function inspectCommand(argv) {
  validateArgv(argv)
  const group = argv[0]
  if (group.startsWith('--')) {
    if (group === '--help' || group === '-h' || group === '--version') {
      return { allowed: true, readOnly: true, destructive: false, requiresConfirm: false, group: 'meta', action: group }
    }
    return { allowed: false, reason: 'Unknown option', group: 'meta', action: group }
  }

  if (BLOCKED_GROUPS.has(group)) {
    return { allowed: false, reason: `Command group '${group}' is blocked by policy`, group, action: argv[1] }
  }

  if (group === 'auth') {
    const action = argv[1]
    if (!action) return { allowed: false, reason: 'auth requires an action', group, action }
    if (BLOCKED_AUTH_ACTIONS.has(action)) {
      return { allowed: false, reason: `auth ${action} is blocked; use ugreen_nas_auth`, group, action }
    }
    if (action === 'status') {
      return { allowed: true, readOnly: true, destructive: false, requiresConfirm: false, group, action }
    }
    if (action === 'logout') {
      return { allowed: true, readOnly: false, destructive: true, requiresConfirm: true, group, action }
    }
    return { allowed: false, reason: `Unknown auth action: ${action}`, group, action }
  }

  const action = argv[1]
  const readActions = READ_ACTIONS[group]
  if (!readActions) {
    return { allowed: false, reason: `Unknown command group: ${group}`, group, action }
  }

  const hasYes = argv.includes('--yes') || argv.includes('-y')
  const specialDestructive =
    group === 'file' && action === 'quota' && argv[2] === 'set'
      ? true
      : DESTRUCTIVE_ACTIONS[group]?.has(action) === true
  const helpRequested = argv.includes('--help') || argv.includes('-h')
  const readOnly = (helpRequested || isReadAction(group, action, argv)) && !specialDestructive
  return {
    allowed: true,
    readOnly,
    destructive: specialDestructive,
    requiresConfirm: specialDestructive || hasYes || !readOnly,
    hasYes,
    group,
    action,
  }
}

export function assertCommandAllowed(argv, { confirm = false, allowWrites = true, requireConfirm = true } = {}) {
  const analysis = inspectCommand(argv)
  if (!analysis.allowed) {
    throw new PluginError('COMMAND_NOT_ALLOWED', analysis.reason, { argv })
  }
  if (!analysis.readOnly && !allowWrites) {
    throw new PluginError('COMMAND_NOT_ALLOWED', 'Write commands are disabled by plugin configuration', { argv })
  }
  if (analysis.requiresConfirm && requireConfirm === true && confirm !== true) {
    throw new PluginError(
      'CONFIRMATION_REQUIRED',
      `Command '${analysis.group}${analysis.action ? ` ${analysis.action}` : ''}' requires explicit confirmation`,
      { argv, destructive: analysis.destructive },
    )
  }
  return analysis
}

export function withDryRun(argv, dryRun) {
  if (!dryRun) return [...argv]
  if (argv.includes('--dry-run')) return [...argv]
  return [...argv, '--dry-run']
}

export function isDestructiveCommand(argv) {
  try {
    return inspectCommand(argv).destructive
  } catch {
    return true
  }
}

export { BLOCKED_GROUPS, BLOCKED_AUTH_ACTIONS, READ_ACTIONS, DESTRUCTIVE_ACTIONS }
