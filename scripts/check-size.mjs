import { brotliCompressSync, gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const QUICK_START_GZIP_LIMIT = 16_000
const entryPoints = [
  ['root', './dist/index.mjs', 'adaptiveDebounce'],
  ['browser', './dist/browser.mjs', 'observeTyping'],
  ['persistence', './dist/persistence.mjs', 'createAdaptiveDelayPersistence'],
]

async function bundle(entryPath, exportName, minify) {
  const result = await build({
    stdin: {
      contents: `export { ${exportName} } from '${entryPath}'`,
      resolveDir: process.cwd(),
      sourcefile: 'size-entry.mjs',
    },
    bundle: true,
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    minify,
    platform: 'browser',
    target: 'es2020',
    treeShaking: true,
    write: false,
  })

  const output = result.outputFiles[0]
  if (!output) throw new Error(`esbuild produced no output for ${entryPath}`)
  return output.contents
}

const measurements = []
for (const [name, entryPath, exportName] of entryPoints) {
  const [raw, minified] = await Promise.all([
    bundle(entryPath, exportName, false),
    bundle(entryPath, exportName, true),
  ])

  measurements.push({
    name,
    raw: raw.byteLength,
    minified: minified.byteLength,
    gzip: gzipSync(minified, { level: 9 }).byteLength,
    brotli: brotliCompressSync(minified).byteLength,
  })
}

console.table(measurements)

const root = measurements[0]
if (!root || root.gzip >= QUICK_START_GZIP_LIMIT) {
  throw new Error(`Root quick-start gzip size must stay below ${QUICK_START_GZIP_LIMIT} bytes.`)
}
