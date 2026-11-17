import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as tar from 'tar'

import { extractArchive, isSafeRelativePath } from '../lib/archive.js'

test('rejects absolute and parent-traversal archive paths', () => {
  assert.equal(isSafeRelativePath('bin/unc'), true)
  assert.equal(isSafeRelativePath('../unc'), false)
  assert.equal(isSafeRelativePath('/tmp/unc'), false)
  assert.equal(isSafeRelativePath('a/../../unc'), false)
})

test('extracts a tar archive and locates the unc binary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ugreen-nas-archive-'))
  try {
    const source = path.join(root, 'source')
    const destination = path.join(root, 'destination')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.join(source, 'bin'), { recursive: true }))
    await writeFile(path.join(source, 'bin', 'unc'), '#!/bin/sh\necho ok\n', { mode: 0o755 })
    const archive = path.join(root, 'unc-test.tar.gz')
    await tar.c({ gzip: true, file: archive, cwd: source }, ['bin'])
    const binary = await extractArchive({ archivePath: archive, destination, binaryName: 'unc' })
    assert.equal(await readFile(binary, 'utf8'), '#!/bin/sh\necho ok\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
