import { defineConfig } from '@playwright/test'

const externalBaseUrl = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './test/browser',
  timeout: 30_000,
  use: {
    baseURL: externalBaseUrl || 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  outputDir: '.playwright/test-results',
  reporter: [['line']],
})
