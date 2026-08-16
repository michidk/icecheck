import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import type { Server as HttpServer } from 'node:http'
import { createDiagnosticRuntime } from './server/diagnostic-runtime.ts'

const basePath = normalizeBasePath(process.env.BASE_PATH)
const allowedHosts = splitList(process.env.ALLOWED_HOSTS)

function diagnosticRuntimePlugin(): Plugin {
  const runtime = createDiagnosticRuntime()
  return {
    name: 'icecheck-diagnostic-runtime',
    configureServer(server) {
      server.middlewares.use(runtime.middleware)
      if (server.httpServer) runtime.attach(server.httpServer as HttpServer)
    },
  }
}

export default defineConfig({
  base: basePath ? `${basePath}/` : '/',
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT || 4173),
    allowedHosts,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    diagnosticRuntimePlugin(),
    tanstackStart({
      srcDirectory: 'src',
      spa: {
        enabled: true,
      },
    }),
    nitro({
      serverDir: 'server',
      features: { websocket: true },
    }),
    viteReact(),
  ],
})

function normalizeBasePath(value = '') {
  const normalized = value.trim().replace(/^\/*|\/*$/g, '')
  return normalized ? `/${normalized}` : ''
}

function splitList(value = '') {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
