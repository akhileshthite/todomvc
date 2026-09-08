import { defineConfig } from '@playwright/test'
import process from 'node:process'
import { PORT } from './test/e2e/ports.mjs'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '*.spec.mjs',
  // Signup derives two keys with scrypt and every todo is a round trip to the
  // server, so the default 30s is not enough on a cold run.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // One server, one database. Running specs in parallel against it makes
  // failures hard to read for no real gain at this size.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // The app has to be rebuilt so the manifest CID it was built with matches
    // the contract the server uploads.
    command: 'npm run build && node test/e2e/server.mjs',
    url: `http://127.0.0.1:${PORT}/app/`,
    timeout: 180_000,
    reuseExistingServer: false
  }
})
