import type { IncomingMessage, ServerResponse } from 'node:http'

type RuntimeEnvironment = Record<string, string | undefined>

export const SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), display-capture=()',
} as const

export function createDiagnosticRuntime(environment: RuntimeEnvironment = process.env) {
  function middleware(request: IncomingMessage, response: ServerResponse, next: () => void) {
    response.setHeader('Cache-Control', 'no-store')
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value)

    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    if (request.method === 'GET' && pathname === '/health') {
      sendJson(response, { ok: true })
      return
    }
    if (request.method === 'GET' && pathname === '/config') {
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

function sendJson(response: ServerResponse, value: unknown) {
  const body = JSON.stringify(value)
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}
