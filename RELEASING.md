# Releasing

Releases are maintainer-run and are not automated. This document does not authorize publishing.

Published versions follow [Semantic Versioning 2.0.0](https://semver.org/). Record consumer-visible
changes in `changelog.md`, and update the manifest version only as part of an approved release.

## Before the first release

- Complete the stored-autofill and real OS IME checks tracked by `VERIFY-001`.
- Confirm the package names, public repository, private security-reporting channel, and npm access.
- Reserve or create the `@adaptive-debounce` npm organization, grant publish access, enable the
  intended provenance and two-factor-authentication policy, and confirm scoped packages will be
  public.
- Define and verify the supported runtime and browser matrix. The ES2020 build target alone is not a
  compatibility promise, so do not add an `engines` range or browser list without evidence.
- Replace every `0.0.0` development version with the approved public SemVer. Decide whether the
  release is coordinated or package-specific, then verify every internal dependency range points
  to a version that will exist on npm.

## Framework compatibility

The current packed-consumer matrix covers:

| Package | Peer range | Verified versions |
| --- | --- | --- |
| `@adaptive-debounce/vue` | Vue `>=3.5.0 <4.0.0` | Vue `3.5.41` |
| `@adaptive-debounce/nuxt` | Nuxt `>=4.4.0 <4.5.0`, Vue `>=3.5.0 <4.0.0` | Nuxt `4.4.2`, Vue `3.5.41` |
| `@adaptive-debounce/react` | React `^18.2.0 || ^19.0.0` | React `18.2.0`, React `19.2.8` |

Do not widen a peer range from version arithmetic alone. Add that version to the packed-consumer
matrix and verify its SSR and strict-type path first.

## Release candidate

From a clean checkout:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm framework:check
pnpm framework:consumer
pnpm framework:size
```

Each package's `prepack` rebuilds its own `dist`. The framework consumer check packs the core and
all three adapters separately, rejects source/tooling files in their tarballs, installs the exact
tarballs, and verifies the public runtime and declaration paths. Inspect the packed manifests too:
no published dependency may retain a `workspace:` range.

When publication is approved, publish in dependency order: core, Vue, React, then Nuxt. Verify each
published package before moving to its dependants. Check the version, changelog, package contents,
provenance settings, npm account, dist-tag, and release tag immediately before each approved publish
command. This document does not authorize any publish command.

Never publish from a dirty checkout or bypass a failing package, size, performance, SSR, or browser
check.
