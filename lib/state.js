import os from 'node:os'
import path from 'node:path'

import { AuthManager } from './auth-manager.js'
import { BinaryManager } from './binary-manager.js'
import { PluginError } from './errors.js'
import { UncRunner } from './unc-runner.js'

export function resolveStateDir(env = process.env) {
  return path.join(env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'ugreen-nas')
}

export function normalizeConfig(config = {}) {
  const versionPolicy = config.versionPolicy ?? 'latest'
  if (versionPolicy !== 'latest' && versionPolicy !== 'pinned') {
    throw new PluginError('CONFIG_INVALID', `versionPolicy must be latest or pinned, got ${versionPolicy}`)
  }
  return {
    versionPolicy,
    pinnedVersion: config.pinnedVersion ?? '0.1.61',
    downloadBase: config.downloadBase,
    autoCheckHours: Number(config.autoCheckHours ?? 24),
    installSkills: config.installSkills !== false,
    timeoutMs: Number(config.timeoutMs ?? 60_000),
    maxOutputBytes: Number(config.maxOutputBytes ?? 1_048_576),
    allowWrites: config.allowWrites !== false,
    requireConfirm: config.requireConfirm !== false,
    dataDir: config.dataDir,
  }
}

export function createRuntime({ config = {}, stateDir } = {}) {
  const normalized = normalizeConfig(config)
  const resolvedStateDir = stateDir ?? normalized.dataDir ?? resolveStateDir()
  const binaryManager = new BinaryManager({
    stateDir: resolvedStateDir,
    versionPolicy: normalized.versionPolicy,
    pinnedVersion: normalized.pinnedVersion,
    downloadBase: normalized.downloadBase,
    autoCheckHours: normalized.autoCheckHours,
    installSkills: normalized.installSkills,
  })
  const runner = new UncRunner({
    binaryManager,
    defaultTimeoutMs: normalized.timeoutMs,
    maxOutputBytes: normalized.maxOutputBytes,
  })
  const auth = new AuthManager({ runner })

  return {
    config: normalized,
    stateDir: resolvedStateDir,
    binaryManager,
    runner,
    auth,
    dispose() {
      auth.dispose()
    },
  }
}
