import { defineEventHandler, setResponseHeader } from 'h3'
import { buildIceConfiguration } from '../diagnostic-runtime.mjs'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return buildIceConfiguration(process.env)
})
