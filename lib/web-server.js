import { loginDefaults, resolveLoginInput } from './env.js'
import { toErrorData } from './errors.js'

const CONNECTION_ROUTE_PATH = '/api/ugreen-nas/auth'
const WEBSERVER_ROUTE_PATH = '/dsh-ugreen-nas/api/auth'
const MAX_BODY_BYTES = 64 * 1024

function publicStatus(status) {
  return {
    state: status.state,
    authenticated: status.authenticated === true,
    message: status.message,
    ...(status.errorCode ? { errorCode: status.errorCode } : {}),
  }
}

async function statusPayload(runtime) {
  const [status, defaults] = await Promise.all([runtime.auth.status(), loginDefaults()])
  return { ok: true, status: publicStatus(status), defaults }
}

async function actionPayload(runtime, body) {
  const action = body.action ?? 'status'
  if (action === 'status') return statusPayload(runtime)
  if (action === 'logout') {
    const result = await runtime.auth.logout()
    return { ok: true, state: 'idle', result: { exitCode: result.exitCode } }
  }
  if (action === 'login') {
    const input = await resolveLoginInput({
      mode: body.mode,
      host: body.host,
      linkId: body.linkId,
      token: body.token,
    })
    return runtime.auth.login(input)
  }
  const error = new Error(`unknown action: ${action}`)
  error.code = 'ACTION_UNKNOWN'
  throw error
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function requestRejected(ctx, req) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection', false) : ctx.connection
  const rejection = connection?.requestRejection?.(req)
  return rejection ?? false
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.code = 'REQUEST_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('request body must be JSON')
    error.code = 'INVALID_JSON'
    throw error
  }
}

async function readFetchBody(request) {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) {
    const error = new Error('request body too large')
    error.code = 'REQUEST_TOO_LARGE'
    throw error
  }
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('request body must be JSON')
    error.code = 'INVALID_JSON'
    throw error
  }
}

function registerConnectionRoute(ctx, runtime, connection) {
  const dispose = connection.fetch.register({
    path: CONNECTION_ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') return jsonResponse(await statusPayload(runtime))
        if (request.method !== 'POST') {
          return jsonResponse({ ok: false, errorCode: 'METHOD_NOT_ALLOWED' }, 405)
        }
        const body = await readFetchBody(request)
        return jsonResponse(await actionPayload(runtime, body))
      } catch (error) {
        return jsonResponse({ ok: false, ...toErrorData(error) }, 400)
      }
    },
  })
  return () => {
    void dispose()
  }
}

function registerWebServerRoute(ctx, runtime, webServer) {
  return webServer.register({
    kind: 'exact',
    path: WEBSERVER_ROUTE_PATH,
    handler: async (req, res) => {
      const rejection = requestRejected(ctx, req)
      if (rejection) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method === 'GET') {
        try {
          sendJson(res, 200, await statusPayload(runtime))
        } catch (error) {
          sendJson(res, 200, { ok: false, ...toErrorData(error) })
        }
        return
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'GET, POST')
        res.end()
        return
      }
      try {
        sendJson(res, 200, await actionPayload(runtime, await readBody(req)))
      } catch (error) {
        sendJson(res, 400, { ok: false, ...toErrorData(error) })
      }
    },
  })
}

export function registerAuthRoute(ctx, runtime) {
  if (typeof ctx.get === 'function') {
    const connection = ctx.get('connection', false)
    if (connection?.fetch?.register) return registerConnectionRoute(ctx, runtime, connection)

    const webServer = ctx.get('webServer', false)
    if (webServer?.register) return registerWebServerRoute(ctx, runtime, webServer)
    return () => {}
  }

  if (ctx.connection?.fetch?.register) return registerConnectionRoute(ctx, runtime, ctx.connection)
  if (ctx.webServer?.register) return registerWebServerRoute(ctx, runtime, ctx.webServer)
  return () => {}
}

export { CONNECTION_ROUTE_PATH, WEBSERVER_ROUTE_PATH, WEBSERVER_ROUTE_PATH as ROUTE_PATH }
