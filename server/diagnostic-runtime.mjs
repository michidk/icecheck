import crypto from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'

const ROOM_TTL_MS = 60 * 60 * 1000
const FORWARDED_TYPES = new Set([
  'signal-ping',
  'signal-pong',
  'probe-start',
  'probe-ready',
  'probe-description',
  'probe-candidate',
  'probe-finish',
  'probe-result',
])

export function createDiagnosticRuntime(environment = process.env) {
  const rooms = new Map()
  const signaling = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
  const basePath = normalizeBasePath(environment.BASE_PATH)
  const runtimePath = (pathname) => `${basePath}${pathname}`
  let attachedServer
  let roomCleanup

  function middleware(request, response, next) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=()')

    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    if (request.method === 'GET' && pathname === runtimePath('/health')) {
      sendJson(response, { ok: true, rooms: rooms.size })
      return
    }
    if (request.method === 'GET' && pathname === runtimePath('/config')) {
      sendJson(response, buildIceConfiguration(environment))
      return
    }
    next()
  }

  function attach(server) {
    if (attachedServer) return close
    attachedServer = server
    server.on('upgrade', handleUpgrade)
    roomCleanup = setInterval(expireRooms, 60_000)
    roomCleanup.unref()
    return close
  }

  function handleUpgrade(request, socket, head) {
    if (new URL(request.url || '/', 'http://localhost').pathname !== runtimePath('/signal')) return
    signaling.handleUpgrade(request, socket, head, (webSocket) => {
      signaling.emit('connection', webSocket, request)
    })
  }

  function expireRooms() {
    const cutoff = Date.now() - ROOM_TTL_MS
    for (const [roomCode, room] of rooms) {
      if (room.createdAt >= cutoff) continue
      send(room.host, { type: 'room-closed' })
      send(room.guest, { type: 'room-closed' })
      room.host.close()
      room.guest?.close()
      rooms.delete(roomCode)
    }
  }

  async function close() {
    if (roomCleanup) clearInterval(roomCleanup)
    if (attachedServer) attachedServer.off('upgrade', handleUpgrade)
    for (const client of signaling.clients) client.close()
    await new Promise((resolve) => signaling.close(resolve))
    attachedServer = undefined
  }

  signaling.on('connection', (socket) => {
    socket.clientId = crypto.randomUUID()
    socket.roomCode = undefined
    socket.role = undefined
    send(socket, { type: 'hello', clientId: socket.clientId, serverTime: Date.now() })

    socket.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        send(socket, { type: 'error', message: 'Invalid signaling message.' })
        return
      }

      if (message?.type === 'create-room') {
        createRoom(socket)
        return
      }
      if (message?.type === 'join-room') {
        joinRoom(socket, normalizeRoomCode(message.roomCode))
        return
      }
      if (!FORWARDED_TYPES.has(message?.type)) return

      const peer = getPeer(socket)
      if (!peer) {
        send(socket, { type: 'error', message: 'The other device is not connected.' })
        return
      }
      send(peer, { ...message, from: socket.clientId })
    })

    socket.on('close', () => leaveRoom(socket))
    socket.on('error', () => leaveRoom(socket))
  })

  function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    do {
      const bytes = crypto.randomBytes(6)
      const code = Array.from(bytes, (byte) => alphabet[byte & 31]).join('')
      if (!rooms.has(code)) return code
    } while (true)
  }

  function createRoom(socket) {
    leaveRoom(socket)
    const roomCode = makeRoomCode()
    rooms.set(roomCode, { host: socket, guest: undefined, createdAt: Date.now() })
    socket.roomCode = roomCode
    socket.role = 'host'
    send(socket, { type: 'room-created', roomCode })
  }

  function joinRoom(socket, roomCode) {
    const room = rooms.get(roomCode)
    if (!room) {
      send(socket, { type: 'join-error', message: 'That test room does not exist.' })
      return
    }
    if (room.guest && room.guest.readyState === WebSocket.OPEN) {
      send(socket, { type: 'join-error', message: 'This test room already has two devices.' })
      return
    }

    leaveRoom(socket)
    room.guest = socket
    socket.roomCode = roomCode
    socket.role = 'guest'
    send(socket, { type: 'room-joined', roomCode, peerId: room.host.clientId })
    send(room.host, { type: 'peer-joined', peerId: socket.clientId })
  }

  function getPeer(socket) {
    const room = rooms.get(socket.roomCode)
    if (!room) return undefined
    return socket.role === 'host' ? room.guest : room.host
  }

  function leaveRoom(socket) {
    const roomCode = socket.roomCode
    const role = socket.role
    socket.roomCode = undefined
    socket.role = undefined
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return
    if (role === 'host' && room.host === socket) {
      send(room.guest, { type: 'room-closed' })
      rooms.delete(roomCode)
    } else if (role === 'guest' && room.guest === socket) {
      room.guest = undefined
      send(room.host, { type: 'peer-left' })
    }
  }

  return { attach, close, middleware }
}

export function buildIceConfiguration(environment = process.env) {
  const stunUrls = splitList(environment.STUN_URLS || 'stun:main.lohr.dev:3478')
    .filter((url) => /^stuns?:/i.test(url))
  const stunServers = stunUrls.length ? [{ urls: stunUrls }] : []
  return { stunServers }
}

function splitList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function normalizeBasePath(value = '') {
  const normalized = String(value).trim().replace(/^\/*|\/*$/g, '')
  return normalized ? `/${normalized}` : ''
}

function normalizeRoomCode(value = '') {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function sendJson(response, value) {
  const body = JSON.stringify(value)
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}
