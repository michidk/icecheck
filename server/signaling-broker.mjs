import crypto from 'node:crypto'

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

export function createSignalingBroker() {
  const connections = new Set()
  const metadata = new WeakMap()
  const rooms = new Map()

  function connect(socket) {
    expireRooms()
    const client = { clientId: crypto.randomUUID(), roomCode: undefined, role: undefined }
    connections.add(socket)
    metadata.set(socket, client)
    send(socket, { type: 'hello', clientId: client.clientId, serverTime: Date.now() })
  }

  function receive(socket, raw) {
    expireRooms()
    let message
    try {
      message = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString())
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
    send(peer, { ...message, from: metadata.get(socket)?.clientId })
  }

  function disconnect(socket) {
    if (!connections.delete(socket)) return
    leaveRoom(socket)
    metadata.delete(socket)
  }

  function closeAll() {
    for (const socket of [...connections]) {
      send(socket, { type: 'room-closed' })
      try { socket.close() } catch {}
      disconnect(socket)
    }
    rooms.clear()
  }

  function expireRooms() {
    const cutoff = Date.now() - ROOM_TTL_MS
    for (const [roomCode, room] of rooms) {
      if (room.createdAt >= cutoff) continue
      send(room.host, { type: 'room-closed' })
      send(room.guest, { type: 'room-closed' })
      try { room.host.close() } catch {}
      try { room.guest?.close() } catch {}
      disconnect(room.host)
      if (room.guest) disconnect(room.guest)
      rooms.delete(roomCode)
    }
  }

  function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    do {
      const bytes = crypto.randomBytes(6)
      const code = Array.from(bytes, (byte) => alphabet[byte & 31]).join('')
      if (!rooms.has(code)) return code
    } while (true)
  }

  function createRoom(socket) {
    const client = metadata.get(socket)
    if (!client) return
    leaveRoom(socket)
    const roomCode = makeRoomCode()
    rooms.set(roomCode, { host: socket, guest: undefined, createdAt: Date.now() })
    client.roomCode = roomCode
    client.role = 'host'
    send(socket, { type: 'room-created', roomCode })
  }

  function joinRoom(socket, roomCode) {
    const client = metadata.get(socket)
    if (!client) return
    const room = rooms.get(roomCode)
    if (!room) {
      send(socket, { type: 'join-error', message: 'That test room does not exist.' })
      return
    }
    if (room.guest && connections.has(room.guest)) {
      send(socket, { type: 'join-error', message: 'This test room already has two devices.' })
      return
    }

    leaveRoom(socket)
    room.guest = socket
    client.roomCode = roomCode
    client.role = 'guest'
    send(socket, { type: 'room-joined', roomCode, peerId: metadata.get(room.host)?.clientId })
    send(room.host, { type: 'peer-joined', peerId: client.clientId })
  }

  function getPeer(socket) {
    const client = metadata.get(socket)
    const room = rooms.get(client?.roomCode)
    if (!room) return undefined
    return client.role === 'host' ? room.guest : room.host
  }

  function leaveRoom(socket) {
    const client = metadata.get(socket)
    const roomCode = client?.roomCode
    const role = client?.role
    if (client) {
      client.roomCode = undefined
      client.role = undefined
    }
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

  function send(socket, message) {
    if (!socket || !connections.has(socket)) return
    try { socket.send(JSON.stringify(message)) } catch { disconnect(socket) }
  }

  return {
    closeAll,
    connect,
    disconnect,
    expireRooms,
    get roomCount() { return rooms.size },
    receive,
  }
}

function normalizeRoomCode(value = '') {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}
