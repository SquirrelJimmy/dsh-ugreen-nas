import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import { registerAuthRoute, ROUTE_PATH, CONNECTION_ROUTE_PATH } from '../lib/web-server.js'

function makeRequest(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  return req
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(value = '') {
      this.body += value
    },
  }
}

function makeContext() {
  let handler
  const webServer = {
    register(route) {
      assert.equal(route.kind, 'exact')
      assert.equal(route.path, ROUTE_PATH)
      handler = route.handler
      return () => {}
    },
  }
  return { ctx: { webServer }, getHandler: () => handler }
}

test('auth route returns status and masks token defaults', async () => {
  const { ctx, getHandler } = makeContext()
  const runtime = {
    auth: {
      status: async () => ({ state: 'idle', authenticated: false, message: 'not logged in' }),
      login: async () => ({ ok: true, state: 'authenticated', authenticated: true }),
      logout: async () => ({ exitCode: 0 }),
    },
  }
  registerAuthRoute(ctx, runtime)
  const res = makeResponse()
  await getHandler()(makeRequest('GET'), res)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.status.authenticated, false)
  assert.equal(Object.hasOwn(body.defaults, 'token'), false)
})

test('auth route passes login input to AuthManager', async () => {
  const { ctx, getHandler } = makeContext()
  let received
  const runtime = {
    auth: {
      status: async () => ({ state: 'idle', authenticated: false }),
      login: async (input) => {
        received = input
        return { ok: true, state: 'authenticated', authenticated: true }
      },
      logout: async () => ({ exitCode: 0 }),
    },
  }
  registerAuthRoute(ctx, runtime)
  const res = makeResponse()
  await getHandler()(makeRequest('POST', { action: 'login', host: 'https://192.168.1.2:9443', token: 'fake-token' }), res)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(received.host, 'https://192.168.1.2:9443')
  assert.equal(received.token, 'fake-token')
  assert.equal(JSON.stringify(body).includes('fake-token'), false)
})

test('auth route passes UGREENlink ID login input to AuthManager', async () => {
  const { ctx, getHandler } = makeContext()
  let received
  const runtime = {
    auth: {
      status: async () => ({ state: 'idle', authenticated: false }),
      login: async (input) => {
        received = input
        return { ok: true, state: 'authenticated', authenticated: true }
      },
      logout: async () => ({ exitCode: 0 }),
    },
  }
  registerAuthRoute(ctx, runtime)
  const res = makeResponse()
  await getHandler()(makeRequest('POST', {
    action: 'login',
    mode: 'linkid',
    linkId: 'your-link-id',
    token: 'fake-token',
  }), res)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(received.mode, 'linkid')
  assert.equal(received.linkId, 'your-link-id')
  assert.equal(received.host, '')
  assert.equal(received.token, 'fake-token')
  assert.equal(JSON.stringify(body).includes('fake-token'), false)
})

test('auth route tolerates missing optional DSH services', () => {
  const ctx = {
    get() {
      return undefined
    },
  }
  const runtime = { auth: {} }
  assert.doesNotThrow(() => registerAuthRoute(ctx, runtime))
})

test('auth route prefers the DSH connection fetch bridge', async () => {
  let route
  const ctx = {
    connection: {
      fetch: {
        register(value) {
          route = value
          return async () => {}
        },
      },
    },
  }
  const runtime = {
    auth: {
      status: async () => ({ state: 'idle', authenticated: false }),
      login: async () => ({ ok: true, state: 'authenticated', authenticated: true }),
      logout: async () => ({ exitCode: 0 }),
    },
  }
  registerAuthRoute(ctx, runtime)
  assert.equal(route.path, CONNECTION_ROUTE_PATH)
  assert.deepEqual(route.methods, ['GET', 'POST'])
  const response = await route.fetch(new Request('http://127.0.0.1/api/ugreen-nas/auth', { method: 'GET' }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.status.authenticated, false)
})
