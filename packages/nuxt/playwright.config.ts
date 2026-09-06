import { defineConfig, devices } from '@playwright/test'

const development = process.env.FRAMEWORK_HMR === '1'
const baseURL = 'http://127.0.0.1:4174'

export default defineConfig({
  testDir: './playwright',
  outputDir: '../../output/playwright/framework-results',
  workers: 1,
  fullyParallel: false,
  reporter: 'line',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: development
      ? 'pnpm exec nuxt dev test/fixtures/nuxt --host 127.0.0.1 --port 4174 --no-fork'
      : 'node test/fixtures/nuxt/.output/server/index.mjs',
    cwd: import.meta.dirname,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NITRO_HOST: '127.0.0.1', NITRO_PORT: '4174', NUXT_TELEMETRY_DISABLED: '1' },
  },
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: development ? 'nuxt-hmr' : 'nuxt-hydration', use: devices['Desktop Chrome'] }],
})
