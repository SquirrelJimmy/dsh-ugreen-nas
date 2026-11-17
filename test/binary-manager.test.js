import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { BinaryManager } from '../lib/binary-manager.js'

test('status reports not installed before the first install', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ugreen-nas-binary-'))
  try {
    const manager = new BinaryManager({ stateDir: root })
    const status = await manager.status()
    assert.equal(status.installed, false)
    assert.equal(status.platform, process.platform === 'darwin' ? 'darwin-' + (process.arch === 'arm64' ? 'arm64' : 'amd64') : status.platform)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
