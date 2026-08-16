import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData } from 'ws'
import { createSignalingBroker } from './signaling-broker.ts'

type RuntimeEnvironment = Record<string, string | undefined>

export function createDiagnosticRuntime(environment: RuntimeEnvironment = process.env) {
  const broker = createSignalingBroker()
  const signaling = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
  const basePath = normalizeBasePath(environment.BASE_PATH)
  const runtimePath = (pathname: string) => `${basePath}${pathname}`
  let attachedServer: HttpServer | undefined
  let roomCleanup: NodeJS.Timeout | undefined

  function middleware(request: IncomingMessage, response: ServerResponse, next: () => void) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=()')

    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    if (request.method === 'GET' && pathname === runtimePath('/health')) {
      sendJson(response, { ok: true, rooms: broker.roomCount })
      return
    }
    if (request.method === 'GET' && pathname === runtimePath('/config')) {
      sendJson(response, buildIceConfiguration(environment))
      return
    }
    next()
  }

  function attach(server: HttpServer) {
    if (attachedServer) return close
    attachedServer = server
    server.on('upgrade', handleUpgrade)
    roomCleanup = setInterval(() => broker.expireRooms(), 60_000)
    roomCleanup.unref()
    return close
  }

  function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    if (new URL(request.url || '/', 'http://localhost').pathname !== runtimePath('/signal')) return
    signaling.handleUpgrade(request, socket, head, (webSocket) => {
      signaling.emit('connection', webSocket, request)
    })
  }

  async function close() {
    if (roomCleanup) clearInterval(roomCleanup)
    if (attachedServer) attachedServer.off('upgrade', handleUpgrade)
    broker.closeAll()
    await new Promise((resolve) => signaling.close(resolve))
    attachedServer = undefined
  }

  signaling.on('connection', (socket) => {
    broker.connect(socket)
    socket.on('message', (raw: RawData) => broker.receive(socket, raw))
    socket.on('close', () => broker.disconnect(socket))
    socket.on('error', () => broker.disconnect(socket))
  })

  return { attach, close, middleware }
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
