import type { IncomingMessage, ServerResponse } from 'node:http'

type RuntimeEnvironment = Record<string, string | undefined>

export function createDiagnosticRuntime(environment: RuntimeEnvironment = process.env) {
  const basePath = normalizeBasePath(environment.BASE_PATH)
  const runtimePath = (pathname: string) => `${basePath}${pathname}`

  function middleware(request: IncomingMessage, response: ServerResponse, next: () => void) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=()')

    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    if (request.method === 'GET' && pathname === runtimePath('/health')) {
      sendJson(response, { ok: true })
      return
    }
    if (request.method === 'GET' && pathname === runtimePath('/config')) {
      sendJson(response, buildIceConfiguration(environment))
      return
    }
    next()
  }

  return { middleware }
}

export function buildIceConfiguration(environment: RuntimeEnvironment = process.env) {
  const stunUrls = splitList(environment.STUN_URLS || 'stun:main.lohr.dev:3478,stun:stun.l.google.com:19302')
    .filter((url) => /^stuns?:/i.test(url))
  const stunServers = stunUrls.length ? [{ urls: stunUrls }] : []
  return { stunServers }
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function normalizeBasePath(value = ''): string {
  const normalized = String(value).trim().replace(/^\/*|\/*$/g, '')
  return normalized ? `/${normalized}` : ''
}

function sendJson(response: ServerResponse, value: unknown) {
  const body = JSON.stringify(value)
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}
