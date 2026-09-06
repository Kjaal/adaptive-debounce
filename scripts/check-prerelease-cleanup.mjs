import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const workflow = await readFile(
  new URL('../.github/workflows/cleanup-prerelease-tags.yml', import.meta.url),
  'utf8',
)
const cleanup = workflow
  .replaceAll('\r\n', '\n')
  .split('      - name: Remove only the matching latest tags')[1]
  .split('        run: |\n')[1]
  .replace(/^ {10}/gm, '')
const bash =
  process.argv[2] ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
const version = '0.1.0-rc.1'
const packages = [
  'adaptive-debounce',
  '@adaptive-debounce/vue',
  '@adaptive-debounce/react',
  '@adaptive-debounce/nuxt',
]

function run(script, args = ['-s']) {
  return new Promise((resolve, reject) => {
    const child = spawn(bash, args, {
      env: { ...process.env, NODE_AUTH_TOKEN: 'local-fixture-only' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 120_000,
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, output }))
    child.stdin.end(script)
  })
}

const syntax = await run(cleanup, ['-n'])
assert.equal(syntax.status, 0, syntax.output)

for (const scenario of [
  'matching',
  'partial',
  'absent',
  'wrong-latest',
  'wrong-next',
  'extra-version',
  'forbidden',
]) {
  const metadata = new Map(
    packages.map((name, index) => [
      name,
      {
        name,
        versions: { [version]: { name, version } },
        'dist-tags': {
          next: version,
          ...(scenario === 'absent' || (scenario === 'partial' && index === 0)
            ? {}
            : { latest: version }),
        },
      },
    ]),
  )
  const last = metadata.get(packages[3])
  if (scenario === 'wrong-latest') last['dist-tags'].latest = '0.2.0'
  if (scenario === 'wrong-next') last['dist-tags'].next = '0.2.0'
  if (scenario === 'extra-version') last.versions['0.2.0'] = { name: last.name, version: '0.2.0' }
  const initialMetadata = structuredClone(metadata)
  const deletions = []
  const server = createServer((request, response) => {
    const path = decodeURIComponent(request.url)
    response.setHeader('content-type', 'application/json')
    const packageName = path.slice(1)
    if (request.method === 'GET' && metadata.has(packageName)) {
      response.end(JSON.stringify(metadata.get(packageName)))
      return
    }
    const target = path.match(/^\/-\/package\/(.+)\/dist-tags(?:\/latest)?$/)?.[1]
    if (target && metadata.has(target)) {
      if (request.method === 'GET') {
        response.end(JSON.stringify(metadata.get(target)['dist-tags']))
        return
      }
      if (request.method === 'DELETE' && path.endsWith('/latest')) {
        deletions.push(target)
        if (scenario === 'forbidden') {
          response.writeHead(403).end(JSON.stringify({ error: 'Forbidden' }))
          return
        }
        delete metadata.get(target)['dist-tags'].latest
        response.end('{}')
        return
      }
    }
    response.writeHead(404).end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const registry = `http://127.0.0.1:${server.address().port}`
    const script = cleanup.replace(
      'registry="https://registry.npmjs.org"',
      `registry="${registry}"`,
    )
    assert.notEqual(script, cleanup, 'The fixture must replace the production registry.')
    // Run the actual npm queries and Bash guards, including next-only package verification.
    const result = await run(script)
    const succeeds = ['matching', 'partial', 'absent'].includes(scenario)
    assert.equal(result.status, succeeds ? 0 : 1, `${scenario}: ${result.output}`)
    assert.deepEqual(
      deletions,
      succeeds
        ? packages.slice(scenario === 'partial' ? 1 : scenario === 'absent' ? 4 : 0)
        : scenario === 'forbidden'
          ? [packages[0]]
          : [],
      scenario,
    )
    if (succeeds) {
      for (const entry of metadata.values()) {
        assert.deepEqual(entry['dist-tags'], { next: version })
        assert.deepEqual(Object.keys(entry.versions), [version])
      }
    } else {
      assert.deepEqual(metadata, initialMetadata)
    }
    console.log(`Validated prerelease cleanup: ${scenario}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
