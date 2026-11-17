import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AuthManager } from '../lib/auth-manager.js'

test('starts the auth process and returns the loopback URL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ugreen-nas-auth-'))
  const script = path.join(root, 'fake-unc')
  await writeFile(script, '#!/bin/sh\nprintf "open http://127.0.0.1:4567/login?code=abc\\n"\nsleep 1\n')
  await chmod(script, 0o755)
  const runner = {
    binaryManager: { getPath: async () => script },
    run: async () => ({ authenticated: false, exitCode: 0, stdout: '{}', stderr: '', data: {} }),
  }
  const auth = new AuthManager({ runner, pollIntervalMs: 100 })
  try {
    const state = await auth.start()
    assert.equal(state.state, 'pending')
    assert.equal(state.url, 'http://127.0.0.1:4567/login?code=abc')
  } finally {
    await auth.cancel()
    auth.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('status recognizes authenticated JSON', async () => {
  const runner = {
    binaryManager: { getPath: async () => '/bin/true' },
    run: async () => ({
      authenticated: true,
      exitCode: 0,
      stdout: '{"authenticated":true}',
      stderr: '',
      data: { authenticated: true },
    }),
  }
  const auth = new AuthManager({ runner })
  const status = await auth.status()
  assert.equal(status.authenticated, true)
  assert.equal(status.state, 'authenticated')
})

test('status redacts token-like fields from auth data', async () => {
  const runner = {
    binaryManager: { getPath: async () => '/bin/true' },
    run: async () => ({
      authenticated: true,
      exitCode: 0,
      stdout: '{"authenticated":true,"token":"should-not-leak"}',
      stderr: '',
      data: { authenticated: true, token: 'should-not-leak', nested: { accessToken: 'also-secret' } },
    }),
  }
  const auth = new AuthManager({ runner })
  const status = await auth.status()
  assert.equal(status.data.token, '[redacted]')
  assert.equal(status.data.nested.accessToken, '[redacted]')
  assert.equal(status.authenticated, true)
})

test('login passes the token through the environment, never argv', async () => {
  const calls = []
  const runner = {
    binaryManager: { getPath: async () => '/bin/true' },
    run: async (argv, options) => {
      calls.push({ argv, options })
      if (argv[0] === 'auth' && argv[1] === 'login') {
        return { exitCode: 0, stdout: '', stderr: '', data: {} }
      }
      return { authenticated: true, exitCode: 0, stdout: '{"authenticated":true}', stderr: '', data: { authenticated: true } }
    },
  }
  const auth = new AuthManager({ runner })
  const result = await auth.login({ host: 'https://192.168.1.20:9443', token: 'fake-token' })
  assert.equal(result.ok, true)
  assert.equal(result.state, 'authenticated')
  const loginCall = calls.find((call) => call.argv[0] === 'auth' && call.argv[1] === 'login')
  assert.deepEqual(loginCall.argv, ['auth', 'login', '--host', 'https://192.168.1.20:9443', '--force', '--insecure'])
  assert.equal(loginCall.options.env.UNC_NAS_TOKEN, 'fake-token')
  assert.equal(JSON.stringify(loginCall.argv).includes('fake-token'), false)
})

test('login keeps certificate verification for public hosts', async () => {
  const calls = []
  const runner = {
    binaryManager: { getPath: async () => '/bin/true' },
    run: async (argv) => {
      calls.push(argv)
      if (argv[0] === 'auth' && argv[1] === 'login') return { exitCode: 0, stdout: '', stderr: '', data: {} }
      return { authenticated: true, exitCode: 0, stdout: '{"authenticated":true}', stderr: '', data: { authenticated: true } }
    },
  }
  const auth = new AuthManager({ runner })
  const result = await auth.login({ host: 'https://nas.example.com:9443', token: 'fake-token' })
  assert.equal(result.ok, true)
  assert.equal(calls.find((argv) => argv[0] === 'auth' && argv[1] === 'login').includes('--insecure'), false)
})

test('linkid login uses the official UGREENlink relay flag', async () => {
  const calls = []
  const runner = {
    binaryManager: { getPath: async () => '/bin/true' },
    run: async (argv, options) => {
      calls.push({ argv, options })
      if (argv[0] === 'auth' && argv[1] === 'login') return { exitCode: 0, stdout: '', stderr: '', data: {} }
      return { authenticated: true, exitCode: 0, stdout: '{"authenticated":true}', stderr: '', data: { authenticated: true } }
    },
  }
  const auth = new AuthManager({ runner })
  const result = await auth.login({ mode: 'linkid', linkId: 'your-link-id', token: 'fake-token' })
  assert.equal(result.ok, true)
  assert.equal(result.message, '已通过 UGREENlink ID 登录')
  const loginCall = calls.find((call) => call.argv[0] === 'auth' && call.argv[1] === 'login')
  assert.deepEqual(loginCall.argv, ['auth', 'login', '--uglink-id', 'your-link-id', '--force'])
  assert.equal(loginCall.options.env.UNC_NAS_TOKEN, 'fake-token')
  assert.equal(Object.hasOwn(loginCall.options.env, 'UNC_NAS_URL'), false)
  assert.equal(JSON.stringify(loginCall.argv).includes('fake-token'), false)
})

test('linkid login accepts a full ug.link URL and rejects malformed ids', async () => {
  const calls = []
  const runner = {
    binaryManager: { getPath: async () => '/bin/true' },
    run: async (argv) => {
      calls.push(argv)
      if (argv[0] === 'auth' && argv[1] === 'login') return { exitCode: 0, stdout: '', stderr: '', data: {} }
      return { authenticated: true, exitCode: 0, stdout: '{"authenticated":true}', stderr: '', data: { authenticated: true } }
    },
  }
  const auth = new AuthManager({ runner })
  const result = await auth.login({ mode: 'linkid', linkId: 'https://ug.link/your-link-id', token: 'fake-token' })
  assert.equal(result.ok, true)
  assert.deepEqual(calls.find((argv) => argv[0] === 'auth' && argv[1] === 'login'), ['auth', 'login', '--uglink-id', 'your-link-id', '--force'])
  await assert.rejects(
    () => auth.login({ mode: 'linkid', linkId: 'https://ug.link/', token: 'fake-token' }),
    (error) => error.code === 'AUTH_LINK_ID_INVALID',
  )
})

test('ddns login accepts a bare hostname and normalizes it to HTTPS', async () => {
  const calls = []
  const runner = {
    binaryManager: { getPath: async () => '/bin/true' },
    run: async (argv) => {
      calls.push(argv)
      if (argv[0] === 'auth' && argv[1] === 'login') return { exitCode: 0, stdout: '', stderr: '', data: {} }
      return { authenticated: true, exitCode: 0, stdout: '{"authenticated":true}', stderr: '', data: { authenticated: true } }
    },
  }
  const auth = new AuthManager({ runner })
  const result = await auth.login({ mode: 'ddns', host: 'nas.example.com:9443', token: 'fake-token' })
  assert.equal(result.ok, true)
  assert.deepEqual(calls.find((argv) => argv[0] === 'auth' && argv[1] === 'login'), [
    'auth',
    'login',
    '--host',
    'https://nas.example.com:9443',
    '--force',
  ])
})
