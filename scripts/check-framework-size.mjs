import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const measurements = [
  {
    name: 'vue client',
    entry: `
      export {
        createAdaptiveDebouncePlugin,
        useAdaptiveDebouncedFn,
        useAdaptiveDelay,
      } from './packages/vue/dist/index.mjs'
    `,
    external: ['vue'],
    expectedCoreInputs: ['dist/index.mjs', 'dist/browser.mjs', 'dist/persistence.mjs'],
  },
  {
    name: 'react client',
    entry: `
      export {
        AdaptiveDebounceProvider,
        useAdaptiveDebouncedCallback,
        useAdaptiveDelay,
      } from './packages/react/dist/index.mjs'
    `,
    external: ['react', 'react/*'],
    expectedCoreInputs: ['dist/index.mjs', 'dist/browser.mjs', 'dist/persistence.mjs'],
  },
  {
    name: 'nuxt module',
    entry: `export { default } from './packages/nuxt/dist/module.mjs'`,
    external: ['@nuxt/kit', '@nuxt/schema', 'nuxt', 'nuxt/*', 'vue'],
    expectedCoreInputs: ['dist/index.mjs'],
  },
  {
    name: 'nuxt client',
    entry: `export { default } from './packages/nuxt/dist/runtime/plugin.js'`,
    external: ['nuxt', 'nuxt/*', 'vue'],
    expectedCoreInputs: ['dist/index.mjs', 'dist/browser.mjs', 'dist/persistence.mjs'],
  },
]

async function bundle(measurement, minify) {
  const result = await build({
    stdin: {
      contents: measurement.entry,
      resolveDir: projectRoot,
      sourcefile: 'framework-size-entry.mjs',
    },
    bundle: true,
    external: measurement.external,
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: !minify,
    minify,
    platform: 'browser',
    target: 'es2020',
    treeShaking: true,
    write: false,
  })

  const output = result.outputFiles[0]
  if (!output) {
    throw new Error(`esbuild produced no output for ${measurement.name}.`)
  }
  if (!minify) {
    const inputs = new Set(
      Object.keys(result.metafile?.inputs ?? {}).map((path) => path.replaceAll('\\', '/')),
    )
    for (const expectedInput of measurement.expectedCoreInputs) {
      if (
        ![...inputs].some((path) => path === expectedInput || path.endsWith(`/${expectedInput}`))
      ) {
        throw new Error(`${measurement.name} did not include ${expectedInput} in its measurement.`)
      }
    }
  }
  return output.contents
}

const results = []
for (const measurement of measurements) {
  const [raw, minified] = await Promise.all([bundle(measurement, false), bundle(measurement, true)])
  results.push({
    name: measurement.name,
    raw: raw.byteLength,
    minified: minified.byteLength,
    gzip: gzipSync(minified, { level: 9 }).byteLength,
    brotli: brotliCompressSync(minified).byteLength,
  })
}

console.table(results)
console.log(
  'Framework peers are external. Imported core, browser, and persistence code is included.',
)
