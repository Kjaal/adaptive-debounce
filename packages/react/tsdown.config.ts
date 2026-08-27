import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  target: 'es2020',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  hash: false,
  failOnWarn: true,
  deps: {
    neverBundle: [/^adaptive-debounce(?:\/.*)?$/, /^react(?:\/.*)?$/],
  },
  suppressWarnings: [
    'TypeScript 7.0 does not yet have a stable API and is experimental. Some options will be unavailable.',
  ],
  checks: { legacyCjs: false },
  outExtensions: ({ format }) =>
    format === 'es' ? { js: '.mjs', dts: '.d.mts' } : { js: '.cjs', dts: '.d.cts' },
})
