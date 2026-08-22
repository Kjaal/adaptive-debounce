import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './playwright',
  outputDir: 'output/playwright/results',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  webServer: {
    command: 'node fixtures/nuxt/.output/server/index.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: '4173',
      NODE_ENV: 'production',
    },
  },
  use: {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
