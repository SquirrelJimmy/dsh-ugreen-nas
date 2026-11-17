import { spawn } from 'node:child_process'

import { PluginError, throwIfAborted } from './errors.js'

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

function tryParseJson(text) {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

export class UncRunner {
  constructor({ binaryManager, defaultTimeoutMs = 60_000, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES } = {}) {
    if (!binaryManager) throw new PluginError('CONFIG_INVALID', 'binaryManager is required')
    this.binaryManager = binaryManager
    this.defaultTimeoutMs = defaultTimeoutMs
    this.maxOutputBytes = maxOutputBytes
  }

  async run(argv, { timeoutMs = this.defaultTimeoutMs, signal, maxOutputBytes = this.maxOutputBytes, env } = {}) {
    throwIfAborted(signal)
    const binaryPath = await this.binaryManager.getPath()
    const startedAt = Date.now()

    return await new Promise((resolve, reject) => {
      const child = spawn(binaryPath, argv, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        env: { ...process.env, ...env },
      })

      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      let truncated = false
      let timedOut = false
      let settled = false
      let killTimer

      const append = (current, chunk, streamName) => {
        const text = chunk.toString('utf8')
        const bytes = Buffer.byteLength(text)
        const total = streamName === 'stdout' ? stdoutBytes : stderrBytes
        const remaining = Math.max(0, maxOutputBytes - total)
        if (bytes > remaining) truncated = true
        const next = remaining > 0 ? text.slice(0, remaining) : ''
        if (streamName === 'stdout') {
          stdout += next
          stdoutBytes += Buffer.byteLength(next)
        } else {
          stderr += next
          stderrBytes += Buffer.byteLength(next)
        }
        return current
      }

      const terminate = () => {
        if (child.killed) return
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), 1_500)
      }

      const onAbort = () => {
        terminate()
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const timer = setTimeout(() => {
        timedOut = true
        terminate()
      }, Math.max(1, Number(timeoutMs) || this.defaultTimeoutMs))

      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }

      const fail = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      }

      child.stdout?.on('data', (chunk) => append(stdout, chunk, 'stdout'))
      child.stderr?.on('data', (chunk) => append(stderr, chunk, 'stderr'))

      child.on('error', (error) => {
        fail(new PluginError('UNC_SPAWN_FAILED', `Failed to start unc: ${error.message}`, { argv }))
      })

      child.on('close', (code, closeSignal) => {
        const durationMs = Date.now() - startedAt
        if (signal?.aborted) {
          finish({
            ok: false,
            exitCode: code ?? -1,
            signal: closeSignal ?? null,
            stdout,
            stderr,
            data: tryParseJson(stdout),
            durationMs,
            truncated,
            errorCode: 'CANCELLED',
            message: 'Operation cancelled',
          })
          return
        }
        if (timedOut) {
          finish({
            ok: false,
            exitCode: code ?? -1,
            signal: closeSignal ?? null,
            stdout,
            stderr,
            data: tryParseJson(stdout),
            durationMs,
            truncated,
            errorCode: 'UNC_TIMEOUT',
            message: `unc timed out after ${timeoutMs}ms`,
          })
          return
        }
        const ok = code === 0
        finish({
          ok,
          exitCode: code ?? -1,
          signal: closeSignal ?? null,
          stdout,
          stderr,
          data: tryParseJson(stdout),
          durationMs,
          truncated,
          ...(ok ? {} : { errorCode: `UNC_EXIT_${code ?? -1}`, message: stderr.trim() || `unc exited with code ${code ?? -1}` }),
        })
      })
    })
  }

  async version() {
    return this.run(['version', '--format', 'json'], { timeoutMs: 15_000 })
  }
}
