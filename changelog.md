# Changelog

## Unreleased

- `PUBLIC-001` Adopted the MIT license, enabled public npm packaging, simplified the README, and scheduled a separate Vue debugging playground.
- `BROWSER-003` Implemented the explicit SSR-safe browser observer with delegated listeners and idempotent teardown.
- `BROWSER-002` Defined browser input, privacy-exclusion, repeat, composition, dynamic-field, and cleanup behavior in tests.
- `PERSIST-001` Implemented opt-in persistence with atomic loads, serialized coalesced writes, clear-race protection, and cleanup.
- `DEBOUNCE-002` Implemented the typed promise-window debounce state machine, including leading, trailing, maximum wait, cancellation, flushing, overlap, and reentry semantics.
- `CORE-003` Implemented the bounded DOM-free clipped-EWMA timing engine and its public state contract.
- `PF-003` Added the strict package foundation, dual ESM/CommonJS exports, public type checks, packed consumer verification, and bundle-size enforcement.
- Automated `VERIFY-001` progress now covers CI, package consumption, SSR/Nuxt hydration, cleanup, privacy, bundle size, and a built-core CPU regression budget; real-device autofill and IME completion remain pending.
- `WF-002` Recorded the approved v1 contracts, dependency order, promise-normalizing wrapper semantics, and shared domain terminology.
- `WF-001` Made `todo.md` the canonical plan and added the per-turn task, changelog, and human-validation workflow.
