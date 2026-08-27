# Contributing

Thanks for helping improve `adaptive-debounce`.

## Before you start

Bug fixes, tests, and documentation improvements are welcome. Open a discussion before changing
the public API, adaptive algorithm, persistence behavior, privacy boundaries, dependencies, or
release tooling so consumers are not surprised by a local design decision.

The root package must remain framework-neutral, SSR-safe, free of runtime dependencies, and below
the documented `16,000` byte minified-and-gzipped quick-start limit. Framework code belongs in the
Vue, Nuxt, or React companion package. Browser observation must never read or retain input content,
and no package may add network requests or telemetry.

## Local setup

Contributor tooling uses the Node.js version in `.node-version` and the pnpm version declared in
`package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

The complete check includes the Chromium browser suite. Install its local test browser once with:

```sh
pnpm exec playwright install chromium
```

For a focused non-browser change, run the relevant test plus formatting, linting, type-checking,
and build checks. Run the complete check before requesting review.

Pull requests targeting `main` run the same core and framework checks in GitHub Actions. There is
no push-triggered workflow, so the repository's first push and later direct pushes start nothing.
Maintainers can start CI manually from the Actions page. The separate npm workflow also requires a
manual start and defaults to package-only; see [RELEASING.md](./RELEASING.md).

## Companion packages

The workspace contains these independently packed packages:

- `adaptive-debounce`: DOM-free core plus optional browser and persistence entry points.
- `@adaptive-debounce/vue`: Vue plugin and composables.
- `@adaptive-debounce/nuxt`: Nuxt module that reuses the Vue package.
- `@adaptive-debounce/react`: React Provider and hooks.

Run the non-browser framework checks with:

```sh
pnpm framework:check
pnpm framework:consumer
pnpm framework:size
```

The packed-consumer check installs the exact tarballs into isolated projects. It verifies Vue SSR,
React 18 and 19 SSR, strict TypeScript/TSX declarations, CommonJS where exported, and a Nuxt
production build and type check. The size check keeps framework peers external and reports raw,
minified, gzip, and Brotli output while including imported core, browser, and persistence code.
There is no adapter size limit yet; explain material growth instead of hiding it.

Current verified framework targets are Vue `3.5.41`, Nuxt `4.4.2`, React `18.2.0`, and React
`19.2.8`. Published peer ranges live in each package manifest. Do not widen those ranges or claim a
Node/browser support matrix without a matching packed-consumer or real-environment check.

## Submitting a change

- Keep each change focused and add the smallest regression test that proves new behavior.
- Update `README.md` and `changelog.md` when public behavior changes.
- Update the affected package README, public declarations, peer range, and packed-consumer matrix
  together when compatibility changes.
- Do not commit generated `dist`, coverage, Nuxt output, tarballs, or dependency directories.
- Use a descriptive commit subject and explain compatibility or privacy implications in the pull
  request.

By contributing, you agree that your contribution is licensed under the project's MIT license and
to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
