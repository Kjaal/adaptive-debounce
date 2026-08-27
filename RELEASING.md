# Releasing

Releases are maintainer-run and are not automated. This document does not authorize publishing.

Published versions follow [Semantic Versioning 2.0.0](https://semver.org/). Record consumer-visible
changes in `changelog.md`, and update the manifest version only as part of an approved release.

## Before the first release

- Complete the stored-autofill and real OS IME checks tracked by `VERIFY-001`.
- Confirm the package name, public repository, private security-reporting channel, and npm access.
- Define and verify the supported runtime and browser matrix. The ES2020 build target alone is not a
  compatibility promise, so do not add an `engines` range or browser list without evidence.

## Release candidate

From a clean checkout:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination ./output
```

`prepack` rebuilds `dist` before the tarball is created. Inspect the tarball, install it in clean ESM
and CommonJS consumers, and confirm strict TypeScript declarations before publishing. Verify the
version, changelog, package contents, provenance settings, npm account, and release tag immediately
before the approved publish command is run.

Never publish from a dirty checkout or bypass a failing package, size, performance, SSR, or browser
check.
