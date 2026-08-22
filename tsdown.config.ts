import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    persistence: 'src/persistence.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2020',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  hash: false,
  failOnWarn: true,
  suppressWarnings: [
    'TypeScript 7.0 does not yet have a stable API and is experimental. Some options will be unavailable.',
  ],
  checks: { legacyCjs: false },
  outExtensions: ({ format }) =>
    format === 'es' ? { js: '.mjs', dts: '.d.mts' } : { js: '.cjs', dts: '.d.cts' },
})
