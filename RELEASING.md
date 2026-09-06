# Releasing

This document defines the public release process for repository maintainers. Publishing requires
access to the protected GitHub environment and permission to publish all four npm packages.

The repository separates verification from publication. Pull requests to `main` run CI, while
**Package and publish npm** runs only when a maintainer starts it manually. Pushes, merges, tags,
and schedules do not publish packages.

Published versions follow [Semantic Versioning 2.0.0](https://semver.org/). The release workflow
uses the version committed to the package manifests. It does not create a Git tag or GitHub Release.

## Release eligibility

An npm release is eligible when:

- release-blocking work and compatibility decisions in `todo.md` are complete or explicitly
  accepted;
- the maintainers control the unscoped `adaptive-debounce` package and the `@adaptive-debounce`
  npm organization, including public publication rights for all three scoped packages;
- `changelog.md` describes the public changes; and
- all four package manifests contain the same approved, nonzero SemVer.

The package manifests are currently `0.1.0-rc.1`; `0.0.0` is a release-blocking development sentinel.
A release updates the version in these committed files:

- `package.json`
- `packages/vue/package.json`
- `packages/react/package.json`
- `packages/nuxt/package.json`

Internal source ranges remain `workspace:^`. pnpm rewrites them to the coordinated public version
while packing, and the release validator rejects incorrect rewrites and retained `workspace:`
ranges. Release versions must be committed before the workflow starts.

The repository keeps Actions permissions read-only by default. Only the protected publish job
receives `id-token: write` for npm provenance and trusted publishing. The `npm-publish` environment
accepts deployments from `main` and requires maintainer approval. GitHub currently permits
repository administrators to bypass that approval, so maintainers should treat approval as required
for normal releases and document any administrative bypass in the release record.

## Build a release candidate

1. Open **Actions → Package and publish npm → Run workflow**.
2. Select the exact `main` commit containing the approved package versions.
3. Enter that shared version and keep `mode` set to `package-only`.
4. Start the workflow and review the completed checks and uploaded artifact.

Package-only mode cannot publish. It runs the core, browser, package, framework, size, and consumer
checks, retains the four exact tarballs used by the consumer checks, validates their manifests,
creates SHA-256 checksums, and uploads the release candidate for seven days.

Local `npm publish` is not a supported release path because it bypasses the tested-artifact,
checksum, protected-environment, provenance, and dependency-order safeguards.

## First npm publication

Trusted publishing is configured per existing npm package. If the four package names cannot be
linked to a trusted publisher before their first publication, the first approved release uses the
workflow's `bootstrap-token` authentication mode.

For the one-time bootstrap on this new, otherwise-empty npm account, a repository administrator:

1. creates a one-day granular npm token with **Packages and scopes** set to **All Packages** and
   **Read and write** access;
2. enables the token's **Bypass two-factor authentication** option;
3. sets **Organizations** to **No access**;
4. reviews npm's generated token summary before creating the token;
5. stores the token only as `NPM_TOKEN_BOOTSTRAP` in the protected `npm-publish` environment;
6. runs the approved publication; and
7. deletes the environment secret and revokes the token immediately after the run, whether the
   publication succeeds or fails.

The bootstrap token must never be pasted into an issue, chat, log, local file, or any other
location. It is intentionally account-wide for this one-time bootstrap because the packages do not
exist yet and therefore cannot be selected individually. The repository must not retain a
general-purpose or repository-wide npm token after the bootstrap.

Once the packages exist, each package uses this npm trusted-publisher configuration:

- owner: `Kjaal`
- repository: `adaptive-debounce`
- workflow: `publish.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

All later releases use the default `trusted` authentication mode and require no npm token. npm
two-factor authentication and package access policies remain enabled, and the repository remains
public so npm can generate provenance. After trusted publishing succeeds, each package should
require two-factor authentication and disallow token-based publication. See npm's
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[provenance](https://docs.npmjs.com/generating-provenance-statements/) guidance.

## Publish an approved version

Start **Package and publish npm** from the approved `main` commit with:

- `mode`: `publish`
- `npm_tag`: `next` for a prerelease or `latest` for an approved stable release
- `auth_mode`: `trusted`, except for the one-time bootstrap described above
- `confirmation`: exactly `publish VERSION to TAG`, for example `publish 1.0.0 to latest`

The protected job downloads and revalidates the tested artifact and checksums. It uses Node.js
`24.20.0` with npm `11.19.0`, publishes with public access and provenance, and processes packages in
fixed order: core, Vue, React, then Nuxt. Prereleases cannot use the `latest` tag.

Publication is resumable after an interrupted run through the shared publication guard. For each
package, an existing version is skipped only when the registry package name, version, and SHA-512
integrity exactly match the validated tarball. A missing registry result, integrity mismatch, name or
version mismatch, or other registry error stops the run; an existing version is never overwritten.

## Prerelease tag cleanup

All four `0.1.0-rc.1` packages were published on August 27, 2026. Install with `@next` until a
stable release is approved. The unintended `latest` tags remain: cleanup run
[33120675727](https://github.com/Kjaal/adaptive-debounce/actions/runs/33120675727) passed preflight
but received npm `E403` on the first `adaptive-debounce` tag deletion, before removing any tags.
The response does not establish which credential or npm policy caused the refusal.

`Remove prerelease latest tags` is retained until cleanup succeeds. Its metadata queries select
`0.1.0-rc.1` explicitly so verification and reruns also work after `latest` is absent. Run
`node scripts/check-prerelease-cleanup.mjs` to exercise the workflow against a local registry
fixture (on Windows, use Git Bash or pass its executable path as the first argument).

Before retrying, the maintainer must resolve npm's refusal for the account and credential used by
the protected `npm-publish` environment. Secret presence or update timestamps alone do not prove
tag-management access. Do not paste credentials into GitHub issues, logs, or chat.
After that condition is resolved, dispatch the workflow on `main` with exactly
`remove latest 0.1.0-rc.1` and approve the protected environment normally. It only removes matching
`latest` tags, preserves `next` and published versions, and skips already-absent tags. Retire the
temporary workflow and its fixture check only after a successful run and registry verification.

## Framework compatibility

The packed-consumer matrix currently covers:

| Package | Peer range | Verified versions |
| --- | --- | --- |
| `@adaptive-debounce/vue` | Vue `>=3.5.0 <4.0.0` | Vue `3.5.41` |
| `@adaptive-debounce/nuxt` | Nuxt `>=4.4.0 <4.5.0`, Vue `>=3.5.0 <4.0.0` | Nuxt `4.4.2`, Vue `3.5.41` |
| `@adaptive-debounce/react` | React `^18.2.0 || ^19.0.0` | React `18.2.0`, React `19.2.8` |

A peer range may be widened only after the new version is added to the packed-consumer matrix and
its SSR and strict-type paths pass.
