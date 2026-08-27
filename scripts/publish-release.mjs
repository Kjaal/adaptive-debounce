import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { packageSpecs, validateReleaseVersion } from './check-release.mjs'

export const npmRegistryUrl = 'https://registry.npmjs.org/'

function releaseError(message) {
  throw new Error(`Safe npm publication failed: ${message}`)
}

export function buildRegistryVersionUrl(packageName, version) {
  return new URL(
    `${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
    npmRegistryUrl,
  )
}

async function readArchiveIntegrity(archivePath) {
  let archive
  try {
    archive = await readFile(archivePath)
  } catch (error) {
    releaseError(`could not read ${archivePath}.`)
    throw error
  }

  return `sha512-${createHash('sha512').update(archive).digest('base64')}`
}

function assertRegistryResponse(response, requestUrl) {
  if (!response || !Number.isInteger(response.status)) {
    releaseError(`the registry returned a malformed response for ${requestUrl}.`)
  }
  if (response.url !== requestUrl) {
    releaseError(`the registry response URL was unexpected for ${requestUrl}.`)
  }
}

function assertExistingManifest(payload, packageName, version, integrity, requestUrl) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    releaseError(`the registry returned a malformed package response for ${requestUrl}.`)
  }
  if (Object.hasOwn(payload, 'versions')) {
    releaseError(`the registry returned ambiguous package metadata for ${requestUrl}.`)
  }
  if (
    payload.name !== packageName ||
    payload.version !== version ||
    !payload.dist ||
    typeof payload.dist !== 'object' ||
    Array.isArray(payload.dist) ||
    payload.dist.integrity !== integrity
  ) {
    releaseError(`the published ${packageName}@${version} does not match the validated tarball.`)
  }
}

export async function inspectPublicationState({
  packageName,
  version,
  integrity,
  fetchImpl = fetch,
}) {
  const requestUrl = buildRegistryVersionUrl(packageName, version).toString()
  let response
  try {
    response = await fetchImpl(requestUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
    })
  } catch (error) {
    releaseError(`the registry request failed for ${requestUrl}.`)
    throw error
  }

  assertRegistryResponse(response, requestUrl)
  if (response.status === 404) {
    return 'publish'
  }
  if (response.status !== 200) {
    releaseError(`the registry returned HTTP ${response.status} for ${requestUrl}.`)
  }

  let payload
  try {
    if (typeof response.text !== 'function') {
      releaseError(`the registry returned a malformed response for ${requestUrl}.`)
    }
    payload = JSON.parse(await response.text())
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Safe npm publication failed:')) {
      throw error
    }
    releaseError(`the registry returned invalid JSON for ${requestUrl}.`)
  }
  assertExistingManifest(payload, packageName, version, integrity, requestUrl)
  return 'skip'
}

export function buildNpmPublishArgs({ artifactPath, tag }) {
  return [
    'publish',
    artifactPath,
    '--registry',
    npmRegistryUrl,
    '--access',
    'public',
    '--provenance',
    '--tag',
    tag,
  ]
}

function runNpmPublish({ artifactPath, tag }) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npmCommand, buildNpmPublishArgs({ artifactPath, tag }), {
    env: process.env,
    shell: false,
    stdio: 'inherit',
  })

  return new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('exit', (exitCode, signal) => {
      if (exitCode === 0) {
        resolvePromise()
        return
      }
      rejectPromise(
        new Error(
          `npm publish failed for ${artifactPath} with ${signal ? `signal ${signal}` : `exit code ${exitCode}`}.`,
        ),
      )
    })
  })
}

export async function publishRelease({
  artifactDirectory,
  version,
  tag,
  fetchImpl = fetch,
  publishImpl = runNpmPublish,
  log = console.log,
}) {
  const { prerelease } = validateReleaseVersion(version)
  if (tag !== 'next' && tag !== 'latest') {
    releaseError(`npm tag must be next or latest; received ${JSON.stringify(tag)}.`)
  }
  if (prerelease && tag === 'latest') {
    releaseError('a prerelease version cannot be published with the latest tag.')
  }

  for (const spec of packageSpecs) {
    const artifactPath = join(artifactDirectory, spec.artifactName(version))
    const integrity = await readArchiveIntegrity(artifactPath)
    const state = await inspectPublicationState({
      packageName: spec.name,
      version,
      integrity,
      fetchImpl,
    })

    if (state === 'skip') {
      log(`Skipped ${spec.name}@${version}: the registry has the exact validated tarball.`)
      continue
    }

    if ((await readArchiveIntegrity(artifactPath)) !== integrity) {
      releaseError(`${artifactPath} changed after validation.`)
    }
    log(`Publishing ${spec.name}@${version}.`)
    await publishImpl({ artifactPath, packageName: spec.name, tag, version })
  }
}

function fakeResponse(requestUrl, status, body) {
  return { status, url: requestUrl, text: async () => body }
}

async function expectFailure(callback, expectedMessage) {
  try {
    await callback()
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return
    }
    throw error
  }
  throw new Error(`Publication self-check did not reject ${expectedMessage}.`)
}

async function runSelfTest() {
  const version = '1.2.3'
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'adaptive-debounce-release-'))
  try {
    for (const spec of packageSpecs) {
      await writeFile(join(artifactDirectory, spec.artifactName(version)), `archive:${spec.name}`)
    }

    const coreSpec = packageSpecs[0]
    const corePath = join(artifactDirectory, coreSpec.artifactName(version))
    const coreIntegrity = await readArchiveIntegrity(corePath)
    const coreUrl = buildRegistryVersionUrl(coreSpec.name, version).toString()
    const vueUrl = buildRegistryVersionUrl(packageSpecs[1].name, version).toString()
    if (
      !vueUrl.includes('%40adaptive-debounce%2Fvue') ||
      vueUrl.includes('@adaptive-debounce/vue')
    ) {
      throw new Error('Publication self-check did not encode the scoped package name.')
    }
    const publishArgs = buildNpmPublishArgs({ artifactPath: 'release/test.tgz', tag: 'next' })
    if (
      publishArgs.join('|') !==
      `publish|release/test.tgz|--registry|${npmRegistryUrl}|--access|public|--provenance|--tag|next`
    ) {
      throw new Error('Publication self-check changed npm publication registry or safety flags.')
    }

    const absent = await inspectPublicationState({
      packageName: coreSpec.name,
      version,
      integrity: coreIntegrity,
      fetchImpl: async (url) => fakeResponse(url, 404, ''),
    })
    if (absent !== 'publish') {
      throw new Error('Publication self-check did not publish an absent package.')
    }

    const exact = await inspectPublicationState({
      packageName: coreSpec.name,
      version,
      integrity: coreIntegrity,
      fetchImpl: async (url) =>
        fakeResponse(
          url,
          200,
          JSON.stringify({ name: coreSpec.name, version, dist: { integrity: coreIntegrity } }),
        ),
    })
    if (exact !== 'skip') {
      throw new Error('Publication self-check did not skip an exact existing package.')
    }

    await expectFailure(
      () =>
        inspectPublicationState({
          packageName: coreSpec.name,
          version,
          integrity: coreIntegrity,
          fetchImpl: async (url) =>
            fakeResponse(
              url,
              200,
              JSON.stringify({ name: coreSpec.name, version, dist: { integrity: 'sha512-wrong' } }),
            ),
        }),
      'does not match',
    )
    await expectFailure(
      () =>
        inspectPublicationState({
          packageName: coreSpec.name,
          version,
          integrity: coreIntegrity,
          fetchImpl: async (url) => fakeResponse(url, 200, '{'),
        }),
      'invalid JSON',
    )
    await expectFailure(
      () =>
        inspectPublicationState({
          packageName: coreSpec.name,
          version,
          integrity: coreIntegrity,
          fetchImpl: async () => {
            throw new Error('network down')
          },
        }),
      'request failed',
    )
    await expectFailure(
      () =>
        inspectPublicationState({
          packageName: coreSpec.name,
          version,
          integrity: coreIntegrity,
          fetchImpl: async (url) => fakeResponse(url, 500, 'server error'),
        }),
      'HTTP 500',
    )
    await expectFailure(
      () =>
        inspectPublicationState({
          packageName: coreSpec.name,
          version,
          integrity: coreIntegrity,
          fetchImpl: async () =>
            fakeResponse('https://registry.example.invalid/adaptive-debounce/1.2.3', 404, ''),
        }),
      'response URL was unexpected',
    )
    await expectFailure(
      () =>
        inspectPublicationState({
          packageName: coreSpec.name,
          version,
          integrity: coreIntegrity,
          fetchImpl: async (url) =>
            fakeResponse(
              url,
              200,
              JSON.stringify({
                name: coreSpec.name,
                version,
                versions: {},
                dist: { integrity: coreIntegrity },
              }),
            ),
        }),
      'ambiguous',
    )

    const requestedUrls = []
    const published = []
    await publishRelease({
      artifactDirectory,
      version,
      tag: 'next',
      fetchImpl: async (url) => {
        requestedUrls.push(url)
        if (url === vueUrl) {
          const integrity = await readArchiveIntegrity(
            join(artifactDirectory, packageSpecs[1].artifactName(version)),
          )
          return fakeResponse(
            url,
            200,
            JSON.stringify({ name: packageSpecs[1].name, version, dist: { integrity } }),
          )
        }
        return fakeResponse(url, 404, '')
      },
      publishImpl: async (details) => published.push(details),
      log: () => {},
    })
    if (
      published.map(({ packageName }) => packageName).join(',') !==
      'adaptive-debounce,@adaptive-debounce/react,@adaptive-debounce/nuxt'
    ) {
      throw new Error(
        'Publication self-check did not continue after a new publish and an exact skip.',
      )
    }
    if (
      requestedUrls.join('|') !==
      [
        coreUrl,
        vueUrl,
        buildRegistryVersionUrl(packageSpecs[2].name, version),
        buildRegistryVersionUrl(packageSpecs[3].name, version),
      ]
        .map(String)
        .join('|')
    ) {
      throw new Error('Publication self-check queried packages in the wrong order.')
    }
    console.log('Validated resumable npm publication guard.')
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (mode === 'self-test') {
    await runSelfTest()
  } else if (mode === 'publish') {
    const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))
    await publishRelease({
      artifactDirectory: resolve(process.env.RELEASE_ARTIFACT_DIR ?? join(defaultRoot, 'release')),
      version: process.env.RELEASE_VERSION,
      tag: process.env.RELEASE_NPM_TAG,
    })
  } else {
    throw new Error('Usage: node scripts/publish-release.mjs <self-test|publish>')
  }
}
