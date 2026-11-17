import { defineTool } from '@deepseek-ai/dsh-tools'

import { assertCommandAllowed, withDryRun } from '../policy.js'
import { resolveLoginInput } from '../env.js'

function textResult(value) {
  const parts = []
  if (value?.message) parts.push(value.message)
  if (value?.url) parts.push(`Login URL: ${value.url}`)
  if (value?.state && !value?.message) parts.push(`State: ${value.state}`)
  if (value?.installed !== undefined) parts.push(`Installed: ${value.installed}`)
  if (value?.version) parts.push(`Version: ${value.version}`)
  if (value?.binaryVersion) parts.push(`Binary version: ${value.binaryVersion}`)
  if (value?.stdout) parts.push(String(value.stdout).trimEnd())
  if (value?.stderr) parts.push(`[stderr]\n${String(value.stderr).trimEnd()}`)
  return [{ type: 'text', text: parts.join('\n') || '(no output)' }]
}

function emptyFailure(error, durationMs = 0) {
  return {
    ok: false,
    exitCode: -1,
    stdout: '',
    stderr: '',
    durationMs,
    truncated: false,
    errorCode: error?.code || 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
  }
}

const nasOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    exitCode: { type: 'integer' },
    signal: { type: 'json' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    data: { type: 'json' },
    durationMs: { type: 'integer' },
    truncated: { type: 'boolean' },
    binaryVersion: { type: 'string' },
    errorCode: { type: 'string' },
    message: { type: 'string' },
  },
}

const authOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    state: { type: 'string' },
    authenticated: { type: 'boolean' },
    url: { type: 'string' },
    message: { type: 'string' },
    exitCode: { type: 'integer' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    errorCode: { type: 'string' },
    data: { type: 'json' },
  },
}

const setupOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    installed: { type: 'boolean' },
    version: { type: 'string' },
    path: { type: 'string' },
    platform: { type: 'string' },
    source: { type: 'string' },
    skillsPath: { type: 'string' },
    alreadyInstalled: { type: 'boolean' },
    latestVersion: { type: 'string' },
    updateAvailable: { type: 'boolean' },
    message: { type: 'string' },
    errorCode: { type: 'string' },
  },
}

export function registerTools(ctx, runtime) {
  const tools = [
    defineTool({
      name: 'ugreen_nas',
      description:
        'Run an allowed UGreen NAS unc command. Pass argv as an array of strings, for example ["file","ls","/volume1"]. Destructive commands require confirm=true. Auth management uses ugreen_nas_auth.',
      parameters: {
        argv: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description: 'The unc command and its arguments, without the executable name.',
        },
        confirm: {
          type: 'boolean',
          description: 'Set true only after the user explicitly approves a destructive command.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Append --dry-run when the command supports it.',
        },
        timeoutMs: {
          type: 'integer',
          description: 'Execution timeout in milliseconds. Defaults to 60000.',
        },
        maxOutputBytes: {
          type: 'integer',
          description: 'Maximum stdout/stderr bytes returned. Defaults to 1048576.',
        },
      },
      output: {
        schema: nasOutput,
        render(_args, value) {
          return textResult(value)
        },
      },
      timeoutMs: 180_000,
      async execute(args, exec) {
        try {
          assertCommandAllowed(args.argv, {
            confirm: args.confirm === true,
            allowWrites: runtime.config.allowWrites,
            requireConfirm: runtime.config.requireConfirm,
          })
          const argv = withDryRun(args.argv, args.dryRun === true)
          const result = await runtime.runner.run(argv, {
            timeoutMs: args.timeoutMs ?? runtime.config.timeoutMs,
            maxOutputBytes: args.maxOutputBytes ?? runtime.config.maxOutputBytes,
            signal: exec.signal,
          })
          const current = await runtime.binaryManager.getCurrent()
          return { ...result, ...(current?.version ? { binaryVersion: current.version } : {}) }
        } catch (error) {
          return emptyFailure(error)
        }
      },
    }),
    defineTool({
      name: 'ugreen_nas_auth',
      description:
        'Manage UGreen NAS authentication for the unc CLI. status checks login, login supports DDNS/HTTPS host or UGREENlink ID plus an access token using the internal Host flow, start opens a legacy loopback login URL, cancel stops a pending login, logout clears stored credentials.',
      parameters: {
        action: {
          type: 'string',
          enum: ['status', 'login', 'start', 'cancel', 'logout'],
          required: true,
          description: 'Authentication action.',
        },
        mode: {
          type: 'string',
          enum: ['ddns', 'linkid'],
          description: 'Login mode: ddns for a DDNS/LAN HTTPS address, linkid for UGREENlink ID.',
        },
        host: {
          type: 'string',
          description: 'NAS base URL for DDNS/login, for example https://nas.example.com:9443.',
        },
        linkId: {
          type: 'string',
          description: 'UGREENlink ID for linkid login, for example your-link-id or https://ug.link/your-link-id.',
        },
        token: {
          type: 'string',
          description: 'Access token for login. The token is passed only through UNC_NAS_TOKEN.',
        },
      },
      output: {
        schema: authOutput,
        render(_args, value) {
          return textResult(value)
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        try {
          if (args.action === 'status') {
            const result = await runtime.auth.status()
            return {
              state: result.state,
              authenticated: result.authenticated,
              exitCode: result.exitCode,
              data: result.data,
              ...(result.errorCode ? { errorCode: result.errorCode } : {}),
              ...(result.data?.message ? { message: String(result.data.message) } : {}),
            }
          }
          if (args.action === 'login') {
            const input = await resolveLoginInput({
              mode: args.mode,
              host: args.host,
              linkId: args.linkId,
              token: args.token,
            })
            const result = await runtime.auth.login({ ...input, signal: exec.signal })
            return {
              ...result,
              state: result.state || (result.authenticated ? 'authenticated' : 'idle'),
              authenticated: result.authenticated === true,
            }
          }
          if (args.action === 'start') {
            const state = await runtime.auth.start(exec.signal)
            return { ...state, state: state.state || 'pending' }
          }
          if (args.action === 'cancel') {
            return await runtime.auth.cancel()
          }
          const result = await runtime.auth.logout()
          return {
            state: 'idle',
            ok: result.ok,
            exitCode: result.exitCode,
            ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          }
        } catch (error) {
          return {
            state: 'failed',
            ...emptyFailure(error),
          }
        }
      },
    }),
    defineTool({
      name: 'ugreen_nas_setup',
      description:
        'Inspect, install, or update the official unc binary for the current platform. The plugin downloads from the official UGreen CDN, verifies SHA-256, and switches the active binary atomically.',
      parameters: {
        action: {
          type: 'string',
          enum: ['status', 'install', 'update'],
          required: true,
          description: 'Setup action.',
        },
        versionPolicy: {
          type: 'string',
          enum: ['latest', 'pinned'],
          description: 'Use the latest release or the pinned known-good version.',
        },
        force: {
          type: 'boolean',
          description: 'Reinstall even when the selected version is already active.',
        },
      },
      output: {
        schema: setupOutput,
        render(_args, value) {
          return textResult(value)
        },
      },
      timeoutMs: 600_000,
      async execute(args, exec) {
        try {
          if (args.action === 'status') {
            const status = await runtime.binaryManager.status()
            return {
              ...status,
              ...(status.installed
                ? {}
                : { message: 'unc is not installed. Run ugreen_nas_setup with action=install.' }),
            }
          }
          const result = await runtime.binaryManager.install({
            versionPolicy: args.versionPolicy ?? runtime.config.versionPolicy,
            pinnedVersion: runtime.config.pinnedVersion,
            force: args.force === true || args.action === 'update',
            signal: exec.signal,
          })
          return {
            installed: true,
            ...result,
            ...(result.skillError ? { message: `unc installed; Skill install warning: ${result.skillError}` } : {}),
          }
        } catch (error) {
          return { installed: false, ...emptyFailure(error) }
        }
      },
    }),
  ]

  const disposers = tools.map((tool) => ctx.tools.register(tool))
  return () => {
    for (const dispose of disposers) dispose?.()
  }
}
