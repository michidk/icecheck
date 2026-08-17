import { defineEventHandler, setResponseHeader } from 'h3'
import { SECURITY_HEADERS } from '../diagnostic-runtime.ts'

export default defineEventHandler((event) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    setResponseHeader(event, name, value)
  }
})
