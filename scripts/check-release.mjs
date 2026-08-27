import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const repositorySlug = 'Kjaal/adaptive-debounce'
const repositoryUrl = `git+https://github.com/${repositorySlug}.git`
const bugsUrl = `https://github.com/${repositorySlug}/issues`
const homepageUrl = `https://github.com/${repositorySlug}#readme`
const internalPackageNames = new Set([
  'adaptive-debounce',
  '@adaptive-debounce/vue',
  '@adaptive-debounce/react',
  '@adaptive-debounce/nuxt',
])

export const packageSpecs = [
  {
    key: 'core',
    name: 'adaptive-debounce',
    sourcePath: 'package.json',
    artifactName: (version) => `adaptive-debounce-${version}.tgz`,
    repositoryDirectory: undefined,
    internalDependencies: {},
  },
  {
    key: 'vue',
    name: '@adaptive-debounce/vue',
    sourcePath: 'packages/vue/package.json',
    artifactName: (version) => `adaptive-debounce-vue-${version}.tgz`,
    repositoryDirectory: 'packages/vue',
    internalDependencies: { 'adaptive-debounce': true },
  },
  {
    key: 'react',
    name: '@adaptive-debounce/react',
    sourcePath: 'packages/react/package.json',
    artifactName: (version) => `adaptive-debounce-react-${version}.tgz`,
    repositoryDirectory: 'packages/react',
    internalDependencies: { 'adaptive-debounce': true },
  },
  {
    key: 'nuxt',
    name: '@adaptive-debounce/nuxt',
    sourcePath: 'packages/nuxt/package.json',
    artifactName: (version) => `adaptive-debounce-nuxt-${version}.tgz`,
    repositoryDirectory: 'packages/nuxt',
    internalDependencies: {
      'adaptive-debounce': true,
      '@adaptive-debounce/vue': true,
    },
  },
]

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function releaseError(errors) {
  throw new Error(`Release validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
}

export function validateReleaseVersion(version) {
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('RELEASE_VERSION must be a non-empty exact SemVer.')
  }

  const match = semverPattern.exec(version)
  if (!match) {
    throw new Error(`RELEASE_VERSION \`${version}\` is not an exact SemVer.`)
  }
  if (match[1] === '0' && match[2] === '0' && match[3] === '0') {
    throw new Error('The 0.0.0 development sentinel and its prereleases cannot be released.')
  }

  return { prerelease: match[4] !== undefined }
}

function addEqualityError(errors, label, actual, expected) {
  if (actual !== expected) {
    errors.push(`${label} must be ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`)
  }
}

function validatePublishConfig(manifest, spec, errors) {
  const publishConfig = manifest.publishConfig
  if (
    !publishConfig ||
    typeof publishConfig !== 'object' ||
    Array.isArray(publishConfig) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(publishConfig))
  ) {
    errors.push(`${spec.name} publishConfig must contain only access: "public".`)
    return
  }

  for (const key of Reflect.ownKeys(publishConfig)) {
    if (key !== 'access') {
      errors.push(`${spec.name} publishConfig contains unsupported key ${JSON.stringify(key)}.`)
    }
  }
  addEqualityError(
    errors,
    `${spec.name} publishConfig.access`,
    Object.hasOwn(publishConfig, 'access') ? publishConfig.access : undefined,
    'public',
  )
}

function validateRepository(manifest, spec, errors) {
  if (!manifest.repository || typeof manifest.repository !== 'object') {
    errors.push(`${spec.name} repository must be an object with the canonical GitHub URL.`)
    return
  }

  addEqualityError(errors, `${spec.name} repository.type`, manifest.repository.type, 'git')
  addEqualityError(errors, `${spec.name} repository.url`, manifest.repository.url, repositoryUrl)
  if (spec.repositoryDirectory === undefined) {
    if (manifest.repository.directory !== undefined) {
      errors.push(`${spec.name} repository.directory must be omitted.`)
    }
  } else {
    addEqualityError(
      errors,
      `${spec.name} repository.directory`,
      manifest.repository.directory,
      spec.repositoryDirectory,
    )
  }
}

function validateDependencies(manifest, spec, version, source, errors) {
  const expectedRange = source ? 'workspace:^' : `^${version}`
  const dependencySections = [
    ['dependencies', manifest.dependencies],
    ['optionalDependencies', manifest.optionalDependencies],
    ['peerDependencies', manifest.peerDependencies],
    ['devDependencies', manifest.devDependencies],
  ]

  for (const dependencyName of Object.keys(spec.internalDependencies)) {
    addEqualityError(
      errors,
      `${spec.name} dependencies.${dependencyName}`,
      manifest.dependencies?.[dependencyName],
      expectedRange,
    )
  }

  for (const [sectionName, dependencies] of dependencySections) {
    for (const [dependencyName, range] of Object.entries(dependencies ?? {})) {
      if (typeof range === 'string' && range.startsWith('workspace:') && !source) {
        errors.push(
          `${spec.name} ${sectionName}.${dependencyName} retained ${range} in its tarball.`,
        )
      }
      if (!internalPackageNames.has(dependencyName)) {
        continue
      }
      if (!Object.hasOwn(spec.internalDependencies, dependencyName)) {
        errors.push(
          `${spec.name} has unexpected internal dependency ${sectionName}.${dependencyName}.`,
        )
      } else if (sectionName !== 'dependencies') {
        errors.push(
          `${spec.name} must declare ${dependencyName} in dependencies, not ${sectionName}.`,
        )
      }
    }
  }
}

export function validateManifestObjects(manifests, version, mode) {
  validateReleaseVersion(version)
  if (mode !== 'source' && mode !== 'artifacts') {
    throw new Error(`Manifest validation mode must be source or artifacts; received ${mode}.`)
  }

  const errors = []
  for (const spec of packageSpecs) {
    const manifest = manifests[spec.key]
    if (!manifest || typeof manifest !== 'object') {
      errors.push(`${spec.name} manifest is missing.`)
      continue
    }

    addEqualityError(errors, `${spec.name} name`, manifest.name, spec.name)
    addEqualityError(errors, `${spec.name} version`, manifest.version, version)
    addEqualityError(errors, `${spec.name} license`, manifest.license, 'MIT')
    validatePublishConfig(manifest, spec, errors)
    addEqualityError(errors, `${spec.name} bugs.url`, manifest.bugs?.url, bugsUrl)
    addEqualityError(errors, `${spec.name} homepage`, manifest.homepage, homepageUrl)
    if (manifest.private !== undefined && manifest.private !== false) {
      errors.push(`${spec.name} private must be omitted or false.`)
    }
    validateRepository(manifest, spec, errors)
    validateDependencies(manifest, spec, version, mode === 'source', errors)
  }

  if (errors.length > 0) {
    releaseError(errors)
  }
}

function readTarString(buffer, start, length) {
  const field = buffer.subarray(start, start + length)
  const nullIndex = field.indexOf(0)
  return field.subarray(0, nullIndex === -1 ? field.length : nullIndex).toString('utf8')
}

function readTarSize(header, tarballPath) {
  const value = readTarString(header, 124, 12).trim()
  if (!/^[0-7]+$/.test(value)) {
    throw new Error(`${tarballPath} contains an unsupported tar entry size.`)
  }
  return Number.parseInt(value, 8)
}

async function readPackedManifest(tarballPath) {
  let archive
  try {
    archive = gunzipSync(await readFile(tarballPath))
  } catch (error) {
    throw new Error(`${tarballPath} is not a readable gzip tarball.`, { cause: error })
  }

  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      break
    }

    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const size = readTarSize(header, tarballPath)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > archive.length) {
      throw new Error(`${tarballPath} contains a truncated tar entry.`)
    }

    if (path === 'package/package.json') {
      try {
        return JSON.parse(archive.subarray(dataStart, dataEnd).toString('utf8'))
      } catch (error) {
        throw new Error(`${tarballPath} contains an invalid package/package.json.`, {
          cause: error,
        })
      }
    }

    offset = dataStart + Math.ceil(size / 512) * 512
  }

  throw new Error(`${tarballPath} does not contain package/package.json.`)
}

async function readSourceManifests(projectRoot) {
  const manifests = {}
  for (const spec of packageSpecs) {
    const manifestPath = join(projectRoot, ...spec.sourcePath.split('/'))
    try {
      manifests[spec.key] = JSON.parse(await readFile(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error(`Could not read ${spec.sourcePath}.`, { cause: error })
    }
  }
  return manifests
}

export function validatePublishWorkflow(contents) {
  const workflowLines = contents.split(/\r?\n/).map((line) => line.trim())
  const publishLines = workflowLines.filter(
    (line) => line === 'node scripts/publish-release.mjs publish',
  )
  const inlinePublishLines = workflowLines.filter((line) => line.startsWith('npm publish '))
  const trustedStart = contents.indexOf('- name: Publish with npm trusted publishing')
  const bootstrapStart = contents.indexOf('- name: Publish with the one-time bootstrap token')
  const trustedSection =
    trustedStart >= 0 && bootstrapStart > trustedStart
      ? contents.slice(trustedStart, bootstrapStart)
      : ''
  const bootstrapSection = bootstrapStart >= 0 ? contents.slice(bootstrapStart) : ''
  const errors = []

  if (publishLines.length !== 2) {
    errors.push(
      `Publish workflow must invoke the shared publication guard exactly twice; received ${publishLines.length} invocations.`,
    )
  }
  if (inlinePublishLines.length > 0) {
    errors.push('Publish workflow must delegate every publication to the shared guard.')
  }
  if (!trustedSection.includes('node scripts/publish-release.mjs publish')) {
    errors.push('Trusted publishing must invoke the shared publication guard.')
  }
  if (!bootstrapSection.includes('node scripts/publish-release.mjs publish')) {
    errors.push('Bootstrap-token publishing must invoke the shared publication guard.')
  }
  if (!contents.includes('registry-url: https://registry.npmjs.org')) {
    errors.push('Publish workflow must keep setup-node pinned to the npmjs registry.')
  }
  if (!contents.includes("inputs.auth_mode == 'trusted'")) {
    errors.push('Publish workflow is missing the trusted-publishing path.')
  }
  if (!contents.includes("inputs.auth_mode == 'bootstrap-token'")) {
    errors.push('Publish workflow is missing the bootstrap-token path.')
  }

  if (!contents.includes('node scripts/check-release.mjs artifacts')) {
    errors.push('Publish workflow must validate the exact release tarballs before publication.')
  }

  if (errors.length > 0) {
    releaseError(errors)
  }
}

function expectReleaseValidationFailure(callback, expectedMessage) {
  try {
    callback()
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return
    }
    throw error
  }
  throw new Error(`Release policy self-check did not reject ${expectedMessage}.`)
}

async function validateReleasePolicy(projectRoot) {
  const version = '1.2.3'
  const sourceManifests = structuredClone(await readSourceManifests(projectRoot))
  for (const spec of packageSpecs) {
    sourceManifests[spec.key].version = version
  }
  validateManifestObjects(sourceManifests, version, 'source')

  const maliciousSource = structuredClone(sourceManifests)
  maliciousSource.core.publishConfig.registry = 'https://registry.example.invalid/'
  expectReleaseValidationFailure(
    () => validateManifestObjects(maliciousSource, version, 'source'),
    'publishConfig contains unsupported key "registry"',
  )

  const artifactManifests = structuredClone(sourceManifests)
  for (const spec of packageSpecs) {
    for (const dependencyName of Object.keys(spec.internalDependencies)) {
      artifactManifests[spec.key].dependencies[dependencyName] = `^${version}`
    }
  }
  validateManifestObjects(artifactManifests, version, 'artifacts')

  const maliciousArtifact = structuredClone(artifactManifests)
  maliciousArtifact.core.publishConfig.registry = 'https://registry.example.invalid/'
  expectReleaseValidationFailure(
    () => validateManifestObjects(maliciousArtifact, version, 'artifacts'),
    'publishConfig contains unsupported key "registry"',
  )

  const workflowPath = join(projectRoot, '.github', 'workflows', 'publish.yml')
  validatePublishWorkflow(await readFile(workflowPath, 'utf8'))
}

async function validateChecksums(artifactDirectory, expectedNames) {
  const checksumPath = join(artifactDirectory, 'SHA256SUMS')
  const contents = await readFile(checksumPath, 'utf8')
  const entries = new Map()

  for (const line of contents.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) {2}([^/\\]+)$/.exec(line)
    if (!match) {
      throw new Error(`SHA256SUMS contains an invalid line: ${JSON.stringify(line)}.`)
    }
    if (entries.has(match[2])) {
      throw new Error(`SHA256SUMS lists ${match[2]} more than once.`)
    }
    entries.set(match[2], match[1])
  }

  const errors = []
  for (const name of expectedNames) {
    if (!entries.has(name)) {
      errors.push(`SHA256SUMS is missing ${name}.`)
      continue
    }
    const actual = createHash('sha256')
      .update(await readFile(join(artifactDirectory, name)))
      .digest('hex')
    if (entries.get(name) !== actual) {
      errors.push(`SHA256SUMS does not match ${name}.`)
    }
  }
  for (const name of entries.keys()) {
    if (!expectedNames.has(name)) {
      errors.push(`SHA256SUMS contains unexpected entry ${name}.`)
    }
  }
  if (errors.length > 0) {
    releaseError(errors)
  }
}

export async function validateArtifacts(artifactDirectory, version) {
  const expectedNames = new Set(packageSpecs.map((spec) => spec.artifactName(version)))
  const entries = await readdir(artifactDirectory, { withFileTypes: true })
  const allowedNames = new Set([...expectedNames, 'SHA256SUMS'])
  const errors = []

  for (const expectedName of expectedNames) {
    const entry = entries.find(({ name }) => name === expectedName)
    if (!entry?.isFile()) {
      errors.push(`Release artifacts are missing regular file ${expectedName}.`)
    }
  }
  for (const entry of entries) {
    if (!allowedNames.has(entry.name) || !entry.isFile()) {
      errors.push(`Release artifacts contain unexpected entry ${entry.name}.`)
    }
  }
  if (errors.length > 0) {
    releaseError(errors)
  }

  const manifests = {}
  for (const spec of packageSpecs) {
    manifests[spec.key] = await readPackedManifest(
      join(artifactDirectory, spec.artifactName(version)),
    )
  }
  validateManifestObjects(manifests, version, 'artifacts')

  if (entries.some(({ name }) => name === 'SHA256SUMS')) {
    await validateChecksums(artifactDirectory, expectedNames)
  }
}

function validateDispatch(version) {
  const { prerelease } = validateReleaseVersion(version)
  const npmTag = process.env.RELEASE_NPM_TAG
  const confirmation = process.env.RELEASE_CONFIRMATION
  const repository = process.env.RELEASE_REPOSITORY
  const ref = process.env.RELEASE_REF
  const errors = []

  if (npmTag !== 'next' && npmTag !== 'latest') {
    errors.push(`npm tag must be next or latest; received ${JSON.stringify(npmTag)}.`)
  }
  if (prerelease && npmTag === 'latest') {
    errors.push('A prerelease version cannot be published with the latest tag.')
  }
  addEqualityError(errors, 'repository', repository, repositorySlug)
  addEqualityError(errors, 'git ref', ref, 'refs/heads/main')
  addEqualityError(errors, 'confirmation', confirmation, `publish ${version} to ${npmTag}`)

  if (errors.length > 0) {
    releaseError(errors)
  }
}

async function main() {
  const mode = process.argv[2]
  const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const projectRoot = resolve(process.env.RELEASE_PROJECT_ROOT ?? defaultRoot)
  if (mode === 'policy') {
    await validateReleasePolicy(projectRoot)
    console.log('Validated immutable npm publication policy.')
    return
  }

  const version = process.env.RELEASE_VERSION
  validateReleaseVersion(version)

  if (mode === 'source') {
    validateManifestObjects(await readSourceManifests(projectRoot), version, 'source')
    console.log(`Validated source manifests for ${version}.`)
    return
  }
  if (mode === 'artifacts') {
    const artifactDirectory = resolve(
      process.env.RELEASE_ARTIFACT_DIR ?? join(defaultRoot, 'release'),
    )
    await validateArtifacts(artifactDirectory, version)
    console.log(`Validated release tarballs for ${version}.`)
    return
  }
  if (mode === 'dispatch') {
    validateDispatch(version)
    console.log(`Validated the protected publish request for ${version}.`)
    return
  }

  throw new Error('Usage: node scripts/check-release.mjs <policy|source|artifacts|dispatch>')
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
