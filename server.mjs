import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createDiagnosticRuntime } from './server/diagnostic-runtime.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 3100)
const host = process.env.HOST || '0.0.0.0'
const basePath = normalizeBasePath(process.env.BASE_PATH)
const clientDirectory = path.join(directory, 'dist', 'client')
const shellFile = path.join(clientDirectory, '_shell.html')

const app = express()
const server = http.createServer(app)
const diagnostics = createDiagnosticRuntime()

app.disable('x-powered-by')
app.use(diagnostics.middleware)
app.use(basePath || '/', express.static(clientDirectory, { index: false, maxAge: '1h' }))
app.use((request, response, next) => {
  if (request.method !== 'GET' || !request.accepts('html')) return next()
  const pathname = new URL(request.url || '/', 'http://localhost').pathname
  if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return next()
  response.sendFile(shellFile)
})

diagnostics.attach(server)
server.listen(port, host, () => {
  console.log(`WebRTC tester is ready at http://${host}:${port}`)
})

async function shutdown() {
  await diagnostics.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function normalizeBasePath(value = '') {
  const normalized = value.trim().replace(/^\/*|\/*$/g, '')
  return normalized ? `/${normalized}` : ''
}
