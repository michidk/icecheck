import { defineEventHandler, setResponseHeader } from 'h3'
import { nitroSignalingBroker } from '../nitro-signaling.mjs'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { ok: true, rooms: nitroSignalingBroker.roomCount }
})
