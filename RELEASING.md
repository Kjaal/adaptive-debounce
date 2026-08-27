# Releasing

Releases are maintainer-run through manual GitHub Actions. Nothing publishes on push, pull request,
merge, tag, or schedule. The repository's initial push therefore starts no Actions run. Pull
requests to `main` run CI later, and maintainers can start CI manually when needed.

Published versions follow [Semantic Versioning 2.0.0](https://semver.org/). The workflow does not
create a Git tag or GitHub Release and does not invent a version.

## Prepare the repository and npm

Before the first release:

1. Complete the real-device and compatibility decisions still open in `todo.md`.
2. Confirm ownership of the unscoped `adaptive-debounce` package and the `@adaptive-debounce` npm
   organization. All four names must be available, and the scoped packages must allow public
   publication. This is tracked as `HV-ADAPTIVE-DEBOUNCE-NPM-SCOPE-OWNERSHIP`.
3. Create a protected GitHub environment named `npm-publish`. Limit it to `main`, require a reviewer,
   and prevent administrators from bypassing that review.
4. Keep repository Actions permissions read-only by default. The workflow grants `id-token: write`
   only to the protected publish job for npm provenance and trusted publishing.

The package versions remain `0.0.0` during development. That is a release-blocking sentinel. For an
approved release, set the exact same nonzero SemVer in these committed files and record the public
changes in `changelog.md`:

- `package.json`
- `packages/vue/package.json`
- `packages/react/package.json`
- `packages/nuxt/package.json`

Keep internal source ranges as `workspace:^`. pnpm rewrites them to the coordinated public version
while packing, and the release validator rejects either an incorrect rewrite or a retained
`workspace:` range. Do not make an uncommitted version bump in Actions.

## Create a release candidate

Open **Actions → Package and publish npm → Run workflow**. Choose the exact `main` commit and enter
its committed version. Leave `mode` as `package-only`; this is the safe default and cannot publish.
The workflow runs all core, browser, package, framework, size, and consumer checks, then retains the
four exact tarballs that those consumers used. It validates their manifests, creates SHA-256
checksums, and uploads one artifact for seven days.

Inspect that artifact and the run before requesting publication. Do not casually run `npm publish`
from local files: doing so bypasses the exact-artifact, checksum, protected-environment, provenance,
and dependency-order safeguards.

## Bootstrap npm once

npm trusted publishers are configured per existing package. If npm requires the four packages to
exist first, create a short-lived granular npm token with only the publication access required for
these names and the required 2FA bypass. Store it only as the `NPM_TOKEN_BOOTSTRAP` secret on the
protected `npm-publish` environment, select `bootstrap-token` for the first approved run, and revoke
the token and remove the secret immediately afterwards. Do not create a repository-wide npm token.

After all packages exist, configure an npm trusted publisher for each package with:

- owner: `Kjaal`
- repository: `adaptive-debounce`
- workflow: `publish.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

Future runs use the default `trusted` mode and need no npm token. Keep npm two-factor authentication
and package access policies enabled, and keep the repository public so npm can generate provenance.
After the trusted run succeeds, set each package to require two-factor authentication and disallow
tokens. See npm's
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[provenance](https://docs.npmjs.com/generating-provenance-statements/) guidance.

## Publish an approved version

Run the same manual workflow from `main` with:

- `mode`: `publish`
- `npm_tag`: `next` for a prerelease, or the approved `latest` tag for a stable release
- `auth_mode`: normally `trusted`; use `bootstrap-token` only for the one-time setup above
- `confirmation`: exactly `publish VERSION to TAG`, for example `publish 1.0.0 to latest`

The protected job downloads and revalidates the previously tested artifact and checksums. It uses
Node.js `24.20.0` with npm `11.19.0`, publishes with public access and provenance, and stops on the
first failure. Publication order is fixed: core, Vue, React, then Nuxt. A prerelease cannot use the
`latest` tag.

## Framework compatibility

The current packed-consumer matrix covers:

| Package | Peer range | Verified versions |
| --- | --- | --- |
| `@adaptive-debounce/vue` | Vue `>=3.5.0 <4.0.0` | Vue `3.5.41` |
| `@adaptive-debounce/nuxt` | Nuxt `>=4.4.0 <4.5.0`, Vue `>=3.5.0 <4.0.0` | Nuxt `4.4.2`, Vue `3.5.41` |
| `@adaptive-debounce/react` | React `^18.2.0 || ^19.0.0` | React `18.2.0`, React `19.2.8` |

Do not widen a peer range from version arithmetic alone. Add that version to the packed-consumer
matrix and verify its SSR and strict-type path first.
