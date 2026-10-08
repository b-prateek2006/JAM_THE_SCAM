// Runs against an app that is already up (docker compose / scripts/demo.ps1 / CI's container).
//   E2E_BASE_URL  default http://127.0.0.1:8000
//   E2E_CHANNEL   optional installed browser instead of Playwright's Chromium, e.g. "chrome" or "msedge"
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 240_000, // a whole recorded call plays in real time
  expect: { timeout: 20_000 },
  workers: 1, // every test shares the server's one Whisper model; parallel calls would only queue
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8000',
    channel: process.env.E2E_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
})
