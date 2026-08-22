export default defineNuxtConfig({
  compatibilityDate: '2026-08-22',
  devtools: { enabled: false },
  ssr: true,
  telemetry: false,
  nitro: { preset: 'node-server' },
})
