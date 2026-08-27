import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pnpmCli = process.env.npm_execpath

if (!pnpmCli) {
  throw new Error('Run this check through `pnpm consumer`.')
}

function run(command, arguments_, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${basename(command)} exited with code ${code ?? 'unknown'}.`))
      }
    })
  })
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'adaptive-debounce-consumer-'))

try {
  await run(
    process.execPath,
    [pnpmCli, 'pack', '--config.ignore-scripts=true', '--pack-destination', temporaryRoot],
    projectRoot,
  )
  const tarballName = (await readdir(temporaryRoot)).find((name) => name.endsWith('.tgz'))
  assert.ok(tarballName, 'pnpm pack did not create a tarball.')

  const consumerRoot = join(temporaryRoot, 'consumer')
  await mkdir(consumerRoot)

  const files = {
    'package.json': JSON.stringify(
      {
        name: 'adaptive-debounce-consumer-check',
        private: true,
        type: 'module',
        dependencies: {
          'adaptive-debounce': `file:../${tarballName}`,
        },
      },
      null,
      2,
    ),
    'esm.mjs': `
      import assert from 'node:assert/strict'
      import { adaptiveDebounce, createAdaptiveDelay } from 'adaptive-debounce'
      import { observeTyping } from 'adaptive-debounce/browser'
      import { createAdaptiveDelayPersistence } from 'adaptive-debounce/persistence'

      assert.equal(typeof adaptiveDebounce, 'function')
      assert.equal(typeof createAdaptiveDelayPersistence, 'function')
      assert.equal(
        typeof createAdaptiveDelayPersistence(createAdaptiveDelay()).load,
        'function',
      )
      assert.throws(() => observeTyping(createAdaptiveDelay()), /requires a browser document/)
    `,
    'cjs.cjs': `
      const assert = require('node:assert/strict')
      const { adaptiveDebounce, createAdaptiveDelay } = require('adaptive-debounce')
      const { observeTyping } = require('adaptive-debounce/browser')
      const { createAdaptiveDelayPersistence } = require('adaptive-debounce/persistence')

      assert.equal(typeof adaptiveDebounce, 'function')
      assert.equal(typeof createAdaptiveDelayPersistence, 'function')
      assert.equal(
        typeof createAdaptiveDelayPersistence(createAdaptiveDelay()).load,
        'function',
      )
      assert.throws(() => observeTyping(createAdaptiveDelay()), /requires a browser document/)
    `,
    'consumer.ts': `
      import { adaptiveDebounce, createAdaptiveDelay } from 'adaptive-debounce'
      import { observeTyping } from 'adaptive-debounce/browser'
      import {
        createAdaptiveDelayPersistence,
        type AdaptiveDelayPersistenceAdapter,
      } from 'adaptive-debounce/persistence'

      const delay = createAdaptiveDelay()
      const unsubscribe = delay.subscribe((delayMs) => void delayMs)
      const state = delay.exportState()
      const importResult = delay.importState(state)
      delay.reset()
      unsubscribe()
      const debounced = adaptiveDebounce((value: number) => value * 2, 10)
      const result: Promise<number> = debounced(2)
      const stop: () => void = observeTyping(delay, { root: document })
      const adapter: AdaptiveDelayPersistenceAdapter = {
        load: () => undefined,
        save: () => undefined,
        clear: () => undefined,
      }
      const persistence = createAdaptiveDelayPersistence(delay, adapter)
      const defaultPersistence = createAdaptiveDelayPersistence(delay)
      const defaultAutosaving = createAdaptiveDelayPersistence(delay, {
        autosave: { onError: (_error: unknown) => undefined },
      })

      void result
      void importResult
      void stop
      void persistence
      void defaultPersistence
      void defaultAutosaving
    `,
    'consumer.cts': `
      import adaptive = require('adaptive-debounce')
      import browser = require('adaptive-debounce/browser')
      import persistence = require('adaptive-debounce/persistence')

      const delay: adaptive.AdaptiveDelay = adaptive.createAdaptiveDelay()
      const wrapped = adaptive.adaptiveDebounce((value: string) => value, 10)
      const result: Promise<string> = wrapped('typed')
      const stop: () => void = browser.observeTyping(delay, { root: document })
      const adapter: persistence.AdaptiveDelayPersistenceAdapter = {
        load: () => undefined,
        save: () => undefined,
        clear: () => undefined,
      }
      const controls: persistence.AdaptiveDelayPersistence =
        persistence.createAdaptiveDelayPersistence(delay, adapter)
      const defaultControls: persistence.AdaptiveDelayPersistence =
        persistence.createAdaptiveDelayPersistence(delay)

      void result
      void stop
      void controls
      void defaultControls
    `,
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
          verbatimModuleSyntax: true,
        },
        include: ['consumer.ts', 'consumer.cts'],
      },
      null,
      2,
    ),
  }

  await Promise.all(
    Object.entries(files).map(([name, contents]) =>
      writeFile(join(consumerRoot, name), `${contents.trim()}\n`),
    ),
  )

  await run(
    process.execPath,
    [pnpmCli, 'install', '--frozen-lockfile=false', '--ignore-scripts'],
    consumerRoot,
  )
  await Promise.all(
    ['CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'SECURITY.md'].map((name) =>
      access(join(consumerRoot, 'node_modules', 'adaptive-debounce', name)),
    ),
  )
  await run(process.execPath, ['esm.mjs'], consumerRoot)
  await run(process.execPath, ['cjs.cjs'], consumerRoot)
  await run(
    process.execPath,
    [
      join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc'),
      '--project',
      'tsconfig.json',
    ],
    consumerRoot,
  )

  console.log('Packed ESM, CommonJS, and strict TypeScript consumers passed.')
} finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}
