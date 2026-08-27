import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { module: 'src/module.ts' },
  format: ['esm'],
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
  outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
})
