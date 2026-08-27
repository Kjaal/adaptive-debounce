# Contributing

Thanks for helping improve `adaptive-debounce`.

## Before you start

Bug fixes, tests, and documentation improvements are welcome. Open a discussion before changing
the public API, adaptive algorithm, persistence behavior, privacy boundaries, dependencies, or
release tooling so consumers are not surprised by a local design decision.

The package must remain framework-neutral, SSR-safe, free of runtime dependencies, and below the
documented `16,000` byte minified-and-gzipped quick-start limit. Browser observation must never read
or retain input content, and the package must not add network requests or telemetry.

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

## Submitting a change

- Keep each change focused and add the smallest regression test that proves new behavior.
- Update `README.md` and `changelog.md` when public behavior changes.
- Do not commit generated `dist`, coverage, Nuxt output, tarballs, or dependency directories.
- Use a descriptive commit subject and explain compatibility or privacy implications in the pull
  request.

By contributing, you agree that your contribution is licensed under the project's MIT license and
to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
