import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pnpmCli = process.env.npm_execpath
const typescriptCli = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
const workspaceVersion = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8'),
).version
const releaseDirectoryInput = process.env.ADAPTIVE_DEBOUNCE_RELEASE_DIR
const releaseVersion = process.env.ADAPTIVE_DEBOUNCE_RELEASE_VERSION
const internalPackageNames = new Set([
  'adaptive-debounce',
  '@adaptive-debounce/vue',
  '@adaptive-debounce/react',
  '@adaptive-debounce/nuxt',
])
const expectedInternalDependencies = {
  'adaptive-debounce': {},
  '@adaptive-debounce/vue': { 'adaptive-debounce': `^${workspaceVersion}` },
  '@adaptive-debounce/react': { 'adaptive-debounce': `^${workspaceVersion}` },
  '@adaptive-debounce/nuxt': {
    'adaptive-debounce': `^${workspaceVersion}`,
    '@adaptive-debounce/vue': `^${workspaceVersion}`,
  },
}

if (Boolean(releaseDirectoryInput) !== Boolean(releaseVersion)) {
  throw new Error(
    'Set ADAPTIVE_DEBOUNCE_RELEASE_DIR and ADAPTIVE_DEBOUNCE_RELEASE_VERSION together.',
  )
}

const releaseOutput = releaseDirectoryInput
  ? {
      directory: resolve(projectRoot, releaseDirectoryInput),
      version: releaseVersion,
    }
  : undefined

if (releaseOutput) {
  assert.equal(
    dirname(releaseOutput.directory),
    projectRoot,
    'The retained release directory must be a direct child of the project root.',
  )
  assert.equal(
    releaseOutput.version,
    workspaceVersion,
    'The retained release version must match every packed workspace package.',
  )
}

if (!pnpmCli) {
  throw new Error('Run this check through `pnpm framework:consumer`.')
}

function run(command, arguments_, cwd, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''

    if (capture) {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr?.on('data', (chunk) => {
        stderr += chunk
      })
    }

    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(
          new Error(
            `${basename(command)} exited with code ${code ?? 'unknown'}.${stderr ? `\n${stderr}` : ''}`,
          ),
        )
      }
    })
  })
}

async function packPackage(temporaryRoot, packageName, packageRoot, requiredFiles) {
  const packRoot = join(temporaryRoot, 'packed', packageName)
  await mkdir(packRoot, { recursive: true })
  const output = await run(
    process.execPath,
    [pnpmCli, 'pack', '--json', '--config.ignore-scripts=true', '--pack-destination', packRoot],
    packageRoot,
    true,
  )
  const result = JSON.parse(output)
  assert.equal(result.name, packageName)
  assert.equal(result.version, workspaceVersion)
  assert.equal(typeof result.filename, 'string')

  const files = new Set(result.files.map(({ path }) => path))
  for (const requiredFile of requiredFiles) {
    assert.ok(files.has(requiredFile), `${packageName} is missing ${requiredFile}.`)
  }

  const unexpectedFiles = [...files].filter(
    (path) =>
      !path.startsWith('dist/') &&
      ![
        'CODE_OF_CONDUCT.md',
        'CONTRIBUTING.md',
        'LICENSE',
        'README.md',
        'SECURITY.md',
        'package.json',
      ].includes(path),
  )
  assert.deepEqual(unexpectedFiles, [], `${packageName} packed unexpected source or tooling files.`)

  const tarball = join(packRoot, basename(result.filename))
  await access(tarball)
  return tarball
}

function fileDependency(consumerRoot, tarball) {
  return `file:${relative(consumerRoot, tarball).replaceAll('\\', '/')}`
}

async function writeConsumer(
  consumerRoot,
  dependencies,
  files,
  { overrides = {}, strictPeerDependencies = true } = {},
) {
  await mkdir(consumerRoot, { recursive: true })
  const internalTarballs = Object.fromEntries(
    Object.entries(dependencies).filter(
      ([name]) => name === 'adaptive-debounce' || name.startsWith('@adaptive-debounce/'),
    ),
  )
  await writeFile(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: `adaptive-debounce-${basename(consumerRoot)}-consumer`,
        private: true,
        type: 'module',
        dependencies,
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerRoot, 'pnpm-workspace.yaml'),
    `autoInstallPeers: false\nstrictPeerDependencies: ${strictPeerDependencies}\npackages:\n  - '.'\noverrides:\n${Object.entries(
      { ...internalTarballs, ...overrides },
    )
      .map(([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`)
      .join('\n')}\n`,
  )
  await Promise.all(
    Object.entries(files).map(async ([path, contents]) => {
      const destination = join(consumerRoot, path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, `${contents.trim()}\n`)
    }),
  )
  await run(
    process.execPath,
    [pnpmCli, 'install', '--frozen-lockfile=false', '--ignore-scripts'],
    consumerRoot,
  )
  await verifyInstalledManifests(consumerRoot, Object.keys(dependencies))
}

async function verifyInstalledManifests(consumerRoot, dependencyNames) {
  for (const dependencyName of dependencyNames) {
    if (
      dependencyName !== 'adaptive-debounce' &&
      !dependencyName.startsWith('@adaptive-debounce/')
    ) {
      continue
    }
    const manifestPath = join(
      consumerRoot,
      'node_modules',
      ...dependencyName.split('/'),
      'package.json',
    )
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(manifest.version, workspaceVersion)
    const expectedDependencies = expectedInternalDependencies[dependencyName]
    assert.ok(expectedDependencies, `Missing internal dependency policy for ${dependencyName}.`)
    for (const [name, range] of Object.entries(expectedDependencies)) {
      assert.equal(
        manifest.dependencies?.[name],
        range,
        `${dependencyName} did not rewrite ${name} to ${range}.`,
      )
    }

    const dependencySections = [
      ['dependencies', manifest.dependencies],
      ['optionalDependencies', manifest.optionalDependencies],
      ['peerDependencies', manifest.peerDependencies],
      ['devDependencies', manifest.devDependencies],
    ]
    const ranges = dependencySections.flatMap(([, dependencies]) =>
      Object.values(dependencies ?? {}),
    )
    assert.equal(
      ranges.some((range) => typeof range === 'string' && range.startsWith('workspace:')),
      false,
      `${dependencyName} retained a workspace dependency in its packed manifest.`,
    )
    for (const [sectionName, dependencies] of dependencySections) {
      for (const name of Object.keys(dependencies ?? {})) {
        if (
          internalPackageNames.has(name) &&
          (sectionName !== 'dependencies' || !Object.hasOwn(expectedDependencies, name))
        ) {
          assert.fail(
            `${dependencyName} has unexpected internal dependency ${sectionName}.${name}.`,
          )
        }
      }
    }
  }
}

async function retainReleaseTarballs(tarballs) {
  if (!releaseOutput) {
    return
  }

  let directoryExists = true
  try {
    await access(releaseOutput.directory)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      directoryExists = false
    } else {
      throw error
    }
  }
  if (directoryExists) {
    throw new Error(
      `${releaseOutput.directory} already exists. Remove that release-only directory before retrying.`,
    )
  }

  await mkdir(releaseOutput.directory)
  const destinations = {
    core: `adaptive-debounce-${releaseOutput.version}.tgz`,
    vue: `adaptive-debounce-vue-${releaseOutput.version}.tgz`,
    react: `adaptive-debounce-react-${releaseOutput.version}.tgz`,
    nuxt: `adaptive-debounce-nuxt-${releaseOutput.version}.tgz`,
  }

  try {
    await Promise.all(
      Object.entries(destinations).map(([key, filename]) =>
        copyFile(tarballs[key], join(releaseOutput.directory, filename)),
      ),
    )
  } catch (error) {
    await rm(releaseOutput.directory, { force: true, recursive: true })
    throw error
  }

  console.log(`Retained the four verified tarballs in ${releaseOutput.directory}.`)
}

function strictTypeScriptConfig(include, jsx) {
  return JSON.stringify(
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
        ...(jsx ? { jsx: 'react-jsx' } : {}),
      },
      include,
    },
    null,
    2,
  )
}

async function checkVue(temporaryRoot, tarballs) {
  const consumerRoot = join(temporaryRoot, 'consumers', 'vue')
  await writeConsumer(
    consumerRoot,
    {
      '@adaptive-debounce/vue': fileDependency(consumerRoot, tarballs.vue),
      '@vue/server-renderer': '3.5.41',
      'adaptive-debounce': fileDependency(consumerRoot, tarballs.core),
      vue: '3.5.41',
    },
    {
      'esm.mjs': `
        import assert from 'node:assert/strict'
        import { renderToString } from '@vue/server-renderer'
        import { createSSRApp, defineComponent, h } from 'vue'
        import {
          createAdaptiveDebouncePlugin,
          useAdaptiveDebouncedFn,
          useAdaptiveDelay,
        } from '@adaptive-debounce/vue'

        const app = createSSRApp(defineComponent({
          setup() {
            const delay = useAdaptiveDelay()
            const save = useAdaptiveDebouncedFn((value) => value)
            assert.equal(save.pending(), false)
            return () => h('span', String(delay.value))
          },
        }))
        app.use(createAdaptiveDebouncePlugin({ persistence: true }))
        assert.match(await renderToString(app), />750<\\/span>/)
      `,
      'cjs.cjs': `
        const assert = require('node:assert/strict')
        const { renderToString } = require('@vue/server-renderer')
        const { createSSRApp, defineComponent, h } = require('vue')
        const {
          createAdaptiveDebouncePlugin,
          useAdaptiveDelay,
        } = require('@adaptive-debounce/vue')

        const app = createSSRApp(defineComponent({
          setup() {
            const delay = useAdaptiveDelay()
            return () => h('span', String(delay.value))
          },
        }))
        app.use(createAdaptiveDebouncePlugin())
        renderToString(app).then((html) => assert.match(html, />750<\\/span>/))
      `,
      'consumer.ts': `
        import {
          createAdaptiveDebouncePlugin,
          useAdaptiveDebouncedFn,
          useAdaptiveDelay,
          type AdaptiveDebounceRuntime,
        } from '@adaptive-debounce/vue'

        const plugin = createAdaptiveDebouncePlugin({ persistence: true })

        function useConsumerTypes(): void {
          const delay: Readonly<{ value: number }> = useAdaptiveDelay()
          const save = useAdaptiveDebouncedFn((value: number) => value * 2)
          const result: Promise<number> = save(2)
          const runtime: AdaptiveDebounceRuntime | undefined = undefined
          void delay
          void result
          void runtime
        }

        void plugin
        void useConsumerTypes
      `,
      'tsconfig.json': strictTypeScriptConfig(['consumer.ts'], false),
    },
  )
  await run(process.execPath, ['esm.mjs'], consumerRoot)
  await run(process.execPath, ['cjs.cjs'], consumerRoot)
  await run(process.execPath, [typescriptCli, '--project', 'tsconfig.json'], consumerRoot)
}

async function checkReact(temporaryRoot, tarballs, version, typeVersions) {
  const consumerRoot = join(temporaryRoot, 'consumers', `react-${version.split('.')[0]}`)
  await writeConsumer(
    consumerRoot,
    {
      '@adaptive-debounce/react': fileDependency(consumerRoot, tarballs.react),
      '@types/react': typeVersions.react,
      '@types/react-dom': typeVersions.reactDom,
      'adaptive-debounce': fileDependency(consumerRoot, tarballs.core),
      react: version,
      'react-dom': version,
    },
    {
      'esm.mjs': `
        import assert from 'node:assert/strict'
        import { createElement } from 'react'
        import { renderToString } from 'react-dom/server'
        import {
          AdaptiveDebounceProvider,
          useAdaptiveDebouncedCallback,
          useAdaptiveDelay,
        } from '@adaptive-debounce/react'

        function View() {
          const delay = useAdaptiveDelay()
          const save = useAdaptiveDebouncedCallback((value) => value)
          assert.equal(save.pending(), false)
          return createElement('span', null, String(delay))
        }

        const html = renderToString(
          createElement(
            AdaptiveDebounceProvider,
            { persistence: true },
            createElement(View),
          ),
        )
        assert.match(html, />750<\\/span>/)
      `,
      'cjs.cjs': `
        const assert = require('node:assert/strict')
        const { createElement } = require('react')
        const { renderToString } = require('react-dom/server')
        const {
          AdaptiveDebounceProvider,
          useAdaptiveDelay,
        } = require('@adaptive-debounce/react')

        function View() {
          return createElement('span', null, String(useAdaptiveDelay()))
        }

        const html = renderToString(
          createElement(AdaptiveDebounceProvider, null, createElement(View)),
        )
        assert.match(html, />750<\\/span>/)
      `,
      'consumer.tsx': `
        import {
          AdaptiveDebounceProvider,
          useAdaptiveDebouncedCallback,
          useAdaptiveDelay,
          type AdaptiveDebounceRuntime,
        } from '@adaptive-debounce/react'

        function Form() {
          const delay: number = useAdaptiveDelay()
          const save = useAdaptiveDebouncedCallback((value: number) => value * 2)
          const result: Promise<number> = save(2)
          const runtime: AdaptiveDebounceRuntime | undefined = undefined
          void result
          void runtime
          return <span>{delay}</span>
        }

        const app = (
          <AdaptiveDebounceProvider persistence>
            <Form />
          </AdaptiveDebounceProvider>
        )

        void app
      `,
      'tsconfig.json': strictTypeScriptConfig(['consumer.tsx'], true),
    },
  )
  await run(process.execPath, ['esm.mjs'], consumerRoot)
  await run(process.execPath, ['cjs.cjs'], consumerRoot)
  await run(process.execPath, [typescriptCli, '--project', 'tsconfig.json'], consumerRoot)
}

async function checkNuxt(temporaryRoot, tarballs) {
  const consumerRoot = join(temporaryRoot, 'consumers', 'nuxt')
  await writeConsumer(
    consumerRoot,
    {
      '@adaptive-debounce/nuxt': fileDependency(consumerRoot, tarballs.nuxt),
      '@adaptive-debounce/vue': fileDependency(consumerRoot, tarballs.vue),
      'adaptive-debounce': fileDependency(consumerRoot, tarballs.core),
      nuxt: '4.5.1',
      typescript: '5.9.3',
      vue: '3.5.41',
      'vue-tsc': '3.3.11',
    },
    {
      'nuxt.config.ts': `
        export default defineNuxtConfig({
          devtools: { enabled: false },
          modules: ['@adaptive-debounce/nuxt'],
          adaptiveDebounce: { persistence: true },
        })
      `,
      'app/app.vue': `
        <script setup lang="ts">
        const delay = useAdaptiveDelay()
        const save = useAdaptiveDebouncedFn((value: number) => value * 2)
        const pending: boolean = save.pending()
        </script>

        <template>
          <main>{{ delay }} {{ pending }}</main>
        </template>
      `,
      'tsconfig.json': JSON.stringify({ extends: './.nuxt/tsconfig.json' }, null, 2),
    },
    {
      strictPeerDependencies: false,
      overrides: {
        '@nuxt/cli': '3.37.0',
        '@nuxt/devtools': '3.3.1',
        '@nuxt/kit': '4.5.1',
      },
    },
  )
  await run(process.execPath, [pnpmCli, 'exec', 'nuxt', 'prepare'], consumerRoot)
  await run(process.execPath, [pnpmCli, 'exec', 'nuxt', 'typecheck'], consumerRoot)
  await run(process.execPath, [pnpmCli, 'exec', 'nuxt', 'build'], consumerRoot)
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'adaptive-debounce-framework-consumer-'))

try {
  const tarballs = {
    core: await packPackage(temporaryRoot, 'adaptive-debounce', projectRoot, [
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      'LICENSE',
      'README.md',
      'SECURITY.md',
      'dist/index.mjs',
      'dist/index.cjs',
      'dist/index.d.mts',
      'dist/index.d.cts',
      'dist/browser.mjs',
      'dist/persistence.mjs',
    ]),
    vue: await packPackage(
      temporaryRoot,
      '@adaptive-debounce/vue',
      join(projectRoot, 'packages', 'vue'),
      [
        'LICENSE',
        'README.md',
        'dist/index.mjs',
        'dist/index.cjs',
        'dist/index.d.mts',
        'dist/index.d.cts',
      ],
    ),
    react: await packPackage(
      temporaryRoot,
      '@adaptive-debounce/react',
      join(projectRoot, 'packages', 'react'),
      [
        'LICENSE',
        'README.md',
        'dist/index.mjs',
        'dist/index.cjs',
        'dist/index.d.mts',
        'dist/index.d.cts',
      ],
    ),
    nuxt: await packPackage(
      temporaryRoot,
      '@adaptive-debounce/nuxt',
      join(projectRoot, 'packages', 'nuxt'),
      [
        'LICENSE',
        'README.md',
        'dist/module.mjs',
        'dist/module.d.mts',
        'dist/runtime/plugin.js',
        'dist/runtime/plugin.d.ts',
      ],
    ),
  }

  await checkVue(temporaryRoot, tarballs)
  await checkReact(temporaryRoot, tarballs, '18.2.0', {
    react: '18.3.31',
    reactDom: '18.3.7',
  })
  await checkReact(temporaryRoot, tarballs, '19.2.8', {
    react: '19.2.18',
    reactDom: '19.2.5',
  })
  await checkNuxt(temporaryRoot, tarballs)

  await retainReleaseTarballs(tarballs)

  console.log(
    'Packed Vue, React 18/19, and Nuxt ESM, CommonJS, strict type, and SSR consumers passed.',
  )
} finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}
