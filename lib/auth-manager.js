import { spawn } from 'node:child_process'

import { PluginError } from './errors.js'

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = /token|secret|password|credential|cookie/i.test(key) ? '[redacted]' : redactSensitive(item)
  }
  return result
}

function redactString(value) {
  return String(value || '')
    .replace(/ugpoa_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/("?(?:token|secret|password|credential|cookie)"?\s*[:=]\s*")([^"]+)(")/gi, '$1[redacted]$3')
}

function readAuthenticated(result) {
  const data = result?.data
  if (data && typeof data === 'object' && data.authenticated === true) return true
  return /"authenticated"\s*:\s*true/.test(String(result?.stdout || ''))
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  if (host.endsWith('.local')) return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  return false
}

function isInsecureLocalHost(url) {
  return url.protocol === 'https:' && isPrivateHostname(url.hostname)
}

function normalizeLoginMode({ mode, host, linkId } = {}) {
  const value = String(mode || '').trim().toLowerCase()
  if (value === 'linkid' || value === 'link-id' || value === 'uglink') return 'linkid'
  if (value === 'ddns' || value === 'host') return 'ddns'
  return linkId && !host ? 'linkid' : 'ddns'
}

function normalizeHost(host) {
  const raw = String(host || '').trim()
  if (!raw) throw new PluginError('AUTH_HOST_REQUIRED', 'NAS host is required')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let parsed
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new PluginError('AUTH_HOST_INVALID', 'NAS host must be a valid http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PluginError('AUTH_HOST_INVALID', 'NAS host must be a valid http(s) URL')
  }
  return { host: withScheme.replace(/\/+$/, ''), parsed }
}

function normalizeLinkId(linkId) {
  const raw = String(linkId || '').trim()
  if (!raw) throw new PluginError('AUTH_LINK_ID_REQUIRED', 'UGREENlink ID is required')
  let value = raw
  if (/^https?:\/\//i.test(raw)) {
    let parsed
    try {
      parsed = new URL(raw)
    } catch {
      throw new PluginError('AUTH_LINK_ID_INVALID', 'UGREENlink ID is invalid')
    }
    let candidate = ''
    if (parsed.hostname.toLowerCase() === 'ug.link') {
      candidate = parsed.pathname.split('/').filter(Boolean)[0] || ''
    } else {
      const match = /^([^.]+)\.cn9\.ug\.link$/i.exec(parsed.hostname)
      candidate = match?.[1] || ''
    }
    try {
      value = decodeURIComponent(candidate)
    } catch {
      throw new PluginError('AUTH_LINK_ID_INVALID', 'UGREENlink ID is invalid')
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new PluginError('AUTH_LINK_ID_INVALID', 'UGREENlink ID is invalid')
  }
  return value
}

export class AuthManager {
  constructor({ runner, waitTimeoutMs = 10 * 60 * 1000, pollIntervalMs = 3_000 } = {}) {
    if (!runner) throw new PluginError('CONFIG_INVALID', 'runner is required')
    this.runner = runner
    this.waitTimeoutMs = waitTimeoutMs
    this.pollIntervalMs = pollIntervalMs
    this.state = 'idle'
    this.url = undefined
    this.startedAt = undefined
    this.error = undefined
    this.child = undefined
    this.pollTimer = undefined
    this.startResolve = undefined
    this.startTimer = undefined
  }

  getState() {
    return {
      state: this.state,
      url: this.url,
      startedAt: this.startedAt,
      ...(this.error ? { error: this.error } : {}),
    }
  }

  async status() {
    const result = await this.runner.run(['auth', 'status', '--format', 'json'], { timeoutMs: 15_000 })
    const authenticated = readAuthenticated(result)
    if (authenticated) this.state = 'authenticated'
    else if (this.state === 'authenticated') this.state = 'expired'
    return {
      authenticated,
      state: this.state,
      exitCode: result.exitCode,
      data: redactSensitive(result.data),
      stdout: redactString(result.stdout),
      stderr: redactString(result.stderr),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    }
  }

  async login({ mode, host, linkId, token, signal } = {}) {
    const loginMode = normalizeLoginMode({ mode, host, linkId })
    if (loginMode === 'linkid') {
      if (!linkId) throw new PluginError('AUTH_LINK_ID_REQUIRED', 'UGREENlink ID is required')
    } else if (!host) {
      throw new PluginError('AUTH_HOST_REQUIRED', 'NAS host is required')
    }
    if (!token) throw new PluginError('AUTH_TOKEN_REQUIRED', 'NAS access token is required')

    let args
    let env
    if (loginMode === 'linkid') {
      const normalizedLinkId = normalizeLinkId(linkId)
      args = ['auth', 'login', '--uglink-id', normalizedLinkId, '--force']
      env = { UNC_NAS_TOKEN: token }
    } else {
      const normalized = normalizeHost(host)
      args = ['auth', 'login', '--host', normalized.host, '--force']
      if (isInsecureLocalHost(normalized.parsed)) args.push('--insecure')
      env = { UNC_NAS_URL: normalized.host, UNC_NAS_TOKEN: token }
    }

    this.state = 'pending'
    this.startedAt = new Date().toISOString()
    this.error = undefined
    this.url = undefined
    const result = await this.runner.run(args, {
      timeoutMs: 60_000,
      signal,
      env,
    })
    const status = await this.status()
    if (result.exitCode !== 0 || !status.authenticated) {
      this.state = 'failed'
      this.error = redactString(result.stderr || result.stdout || 'NAS login failed').trim()
      const detail = this.error.split(/\r?\n/)[0]
      return {
        ok: false,
        state: this.state,
        authenticated: false,
        exitCode: result.exitCode,
        errorCode: result.errorCode || 'AUTH_FAILED',
        message: result.exitCode === 0 ? '登录命令已结束，但 NAS 仍未认证' : `登录失败：${detail || '请检查地址和访问令牌'}`,
      }
    }
    this.state = 'authenticated'
    this.error = undefined
    return {
      ok: true,
      state: 'authenticated',
      authenticated: true,
      exitCode: result.exitCode,
      message: loginMode === 'linkid' ? '已通过 UGREENlink ID 登录' : '已通过 DDNS/HTTPS 登录',
    }
  }

  async start(signal) {
    if (this.child) return this.getState()
    const onAbort = () => { void this.cancel() }
    signal?.addEventListener('abort', onAbort, { once: true })
    this.startAbortCleanup = () => signal?.removeEventListener('abort', onAbort)
    let binaryPath
    try {
      binaryPath = await this.runner.binaryManager.getPath()
    } catch (error) {
      this.startAbortCleanup()
      this.startAbortCleanup = undefined
      throw error
    }
    this.state = 'pending'
    this.startedAt = new Date().toISOString()
    this.error = undefined
    this.url = undefined

    return new Promise((resolve) => {
      this.startResolve = resolve
      this.child = spawn(binaryPath, ['auth', 'workbuddy', '--wait-timeout', '10m'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        env: { ...process.env },
      })
      this.wireChild(this.child)
      this.startTimer = setTimeout(() => {
        this.finishStart({
          ...this.getState(),
          message: '登录进程已启动，但暂时没有发现本机登录 URL',
        })
      }, 10_000)
      this.startTimer.unref?.()
      this.startPolling()
    })
  }

  wireChild(child) {
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      const match = buffer.match(/https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/[^\s"'<>]*)?/u)
      if (!match) return
      this.url = match[0]
      this.state = 'pending'
      this.finishStart({
        ...this.getState(),
        message: '已启动本机登录页，请在浏览器完成登录',
      })
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (error) => {
      this.state = 'failed'
      this.error = error.message
      this.child = undefined
      this.finishStart({ ...this.getState(), message: `登录进程启动失败：${error.message}` })
    })
    child.on('close', (code) => {
      const wasCurrent = this.child === child
      if (wasCurrent) this.child = undefined
      this.stopPolling()
      if (this.state === 'authenticated' || this.state === 'cancelled') {
        this.finishStart(this.getState())
        return
      }
      this.status()
        .then((status) => {
          if (status.authenticated) {
            this.state = 'authenticated'
          } else {
            this.state = code === 0 ? 'expired' : 'failed'
            if (code !== 0) this.error = `unc auth workbuddy exited with code ${code}`
          }
          this.finishStart({
            ...this.getState(),
            message: status.authenticated ? '登录成功' : '登录进程已结束',
          })
        })
        .catch((error) => {
          this.state = 'failed'
          this.error = error instanceof Error ? error.message : String(error)
          this.finishStart({ ...this.getState(), message: this.error })
        })
    })
  }

  finishStart(value) {
    this.startAbortCleanup?.()
    this.startAbortCleanup = undefined
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = undefined
    const resolve = this.startResolve
    this.startResolve = undefined
    resolve?.(value)
  }

  startPolling() {
    this.stopPolling()
    const deadline = Date.now() + this.waitTimeoutMs
    this.pollTimer = setInterval(async () => {
      if (!this.child) return
      if (Date.now() > deadline) {
        await this.cancel()
        this.state = 'expired'
        this.error = '登录等待超时'
        this.finishStart(this.getState())
        return
      }
      try {
        const status = await this.status()
        if (status.authenticated) {
          this.state = 'authenticated'
          this.stopPolling()
          this.child?.kill('SIGTERM')
          this.finishStart(this.getState())
        }
      } catch {
        // A transient status failure should not terminate the login flow.
      }
    }, this.pollIntervalMs)
    this.pollTimer.unref?.()
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  async cancel() {
    if (this.child) {
      const child = this.child
      this.child = undefined
      child.kill('SIGTERM')
    }
    this.stopPolling()
    if (this.state === 'pending') this.state = 'cancelled'
    this.finishStart(this.getState())
    return this.getState()
  }

  async logout() {
    const result = await this.runner.run(['auth', 'logout'], { timeoutMs: 30_000 })
    this.state = 'idle'
    this.url = undefined
    this.error = undefined
    return {
      ok: result.ok,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    }
  }

  dispose() {
    this.stopPolling()
    this.child?.kill('SIGTERM')
    this.child = undefined
  }
}
