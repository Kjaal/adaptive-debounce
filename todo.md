# Adaptive Debounce Package — TODO

Status: 25 of 28 scheduled task IDs are complete. The v1 implementation, automated verification, MIT public-package setup, release hardening, and guarded manual GitHub/npm automation are complete. The sibling playground is a separate local-only package tester, not a package release gate. `VERIFY-001` remains open for two real-device checks. The Vue, Nuxt, and React packages and their non-browser automated acceptance are implemented under `FRAMEWORK-001`, which remains open for manual Nuxt client validation and one React concurrent-render decision. The first `0.1.0-rc.1` release candidate is published; `RELEASE-004` remains open until the unintended `latest` tags are cleaned up. npm name and scope control is confirmed for the new `Kjaal` account and `@adaptive-debounce` organization; the release-environment administrator-bypass policy remains pending under `HV-ADAPTIVE-DEBOUNCE-RELEASE-ADMIN-BYPASS`. Cleanup run `33120675727` passed preflight but received npm `E403` on the first deletion, leaving all four `latest` tags unchanged. The exact runtime/browser support policy remains a pre-release decision. Working project and package name: `adaptive-debounce`.

## Product Goal

Create a lightweight TypeScript package that learns a user's typing rhythm locally and provides a stable, bounded debounce delay. Developers can use that delay with the package's own debounce utility or integrate it into another workflow without adopting a framework. Keep the documented default browser quick-start import below 16 kB after minification and gzip compression if possible.

## Active Handoff Queue

- [x] `CORE-006` Keep delay notifications current when a subscriber resets or imports state during dispatch. Deterministic reset/import regressions, first-error propagation, and idempotent cleanup pass. Resolves `HV-ADAPTIVE-DEBOUNCE-DELAY-REENTRANT-NOTIFY` (issue #1).

Complete one item per turn in dependency order. Decision items require user approval before their dependent implementation begins.

- [x] `WF-001` Make `todo.md` the canonical plan and establish the per-turn changelog and human-validation workflow.
- [x] `WF-002` Record the approved v1 contracts, dependency order, and shared terminology without changing source code.

### 1. Package foundation

- [x] `PF-001` Decision: use Node.js 22.18+ for contributors and emit ES2020 ESM and CommonJS with matching declarations.
- [x] `PF-002` Decision: use the approved pnpm, TypeScript, tsdown, Vitest, Biome, publint, and esbuild toolchain.
- [x] `PF-003` Scaffold and verify the strict package foundation, exports, consumer import test, and size check after `PF-001` and `PF-002`.

### 2. DOM-free core and debounce

- [x] `CORE-001` Decision: approve the version-one public API sketch.
- [x] `CORE-002` Decision: approve the constant-memory clipped-EWMA timing model and deterministic cold start.
- [x] `DEBOUNCE-001` Decision: approve promise-window concurrency, cancellation, and stale-result semantics.
- [x] `CORE-003` Implement and test the bounded DOM-free timing engine after `PF-003`, `CORE-001`, and `CORE-002`.
- [x] `CORE-004` Implemented the approved post-typing recommendation: estimate a five-character word time from the clipped EWMA, add a configurable `quietPeriodMs`, and clamp the result to revised bounds. The package defaults to minimum `500 ms`, initial `750 ms`, maximum `1,500 ms`, interval multiplier `5`, quiet period `350 ms`, smoothing `0.25`, and idle reset `2,000 ms`; the first qualifying interval uses a derived cold cadence prior with the same clipping and EWMA smoothing as later samples; `AdaptiveDelayStateV1` remains unchanged and content remains uninspected. Automated and live playground acceptance passed: cold `750 ms`, first `1.4 s` interval `850 ms`, maximum adjacent learned-delay change `197.59 ms`, zero mid-sentence saves across `120–400 ms` pauses, exactly one final quiet-period save, and bounded reset behavior.
- [x] `CORE-005` Curved mature smoothing without changing the public API or state: the first accepted interval keeps the full configured `smoothing` weight, then later intervals use `smoothing / (1 + 2 × relative error)` so large mature changes move the recommendation less while sustained cadence still converges. Deterministic acceptance passed for exact arithmetic, fast first-sample learning, monotonic convergence, finite extremes, reset/import compatibility, and a supplied-trace jump reduced from about `225 ms` to `75.16 ms`; all package checks pass.
- [x] `DEBOUNCE-002` Implement and test the typed debounce state machine after `CORE-003` and `DEBOUNCE-001`.

### 3. Optional subpaths and verification

- [x] `BROWSER-001` Decision: use explicit observation, instance-owned profiles, explicit persistence, and clear server-call errors.
- [x] `PERSIST-001` Implement and test the optional persistence entry point after `CORE-003`.
- [x] `PERSIST-002` Use the fixed `adaptive-debounce:state` localStorage key when the persistence adapter is omitted, while preserving explicit load/save, opt-in autosave, custom adapters, SSR-safe import and construction, privacy-safe version-one state, and existing clear, disposal, and error behavior. Node, type, packed-consumer, build, Nuxt SSR-build, size, and performance acceptance pass.
- [x] `BROWSER-002` Define browser input edge cases and cleanup behavior in tests after `CORE-003` and `BROWSER-001`.
- [x] `BROWSER-003` Implement and test the optional observer after `BROWSER-002`.
- [ ] `VERIFY-001` Verify SSR imports, Nuxt hydration, cleanup, privacy, package consumption, and the 16 kB target after `DEBOUNCE-002`, `PERSIST-001`, and `BROWSER-003`.
  - Automated checks pass; completion still requires these real-device validations:
    - `HV-ADAPTIVE-DEBOUNCE-BROWSER-AUTOFILL`
    - `HV-ADAPTIVE-DEBOUNCE-BROWSER-IME-COMPLETION`
  - Run both checks from the sibling `adaptive-debounce-playground` using its **Real OS checks** panel; the same instructions are in that project's README.

### 4. Public package and debugging playground

- [x] `PUBLIC-001` Adopt the MIT license, make the manifest publicly publishable, simplify the public README, and schedule the separate debugging playground without publishing a release.
- [x] `RELEASE-001` Harden the public package without publishing: reject timer durations above the platform-safe maximum, validate persistence options strictly, bound stalled persistence lifecycle operations, build automatically before packing, keep standalone artifact checks fresh, add concise contribution and security policies, document state interoperability and sensitive-control boundaries, reconcile historical task traceability, and keep the sibling playground local-only and outside package release gating.
- [x] `RELEASE-002` Add repository metadata and guarded GitHub release automation without running Actions or publishing. Acceptance: the initial push triggers no workflow; pull-request and manual CI use pinned official actions and read-only permissions; the manual npm workflow defaults to package-only, rejects the `0.0.0` sentinel, preserves and revalidates the exact consumer-tested tarballs, publishes only through the protected `npm-publish` environment in core → Vue → React → Nuxt order, resumes interrupted publication only for an exact registry name/version/SHA-512 match, supports one-time bootstrap-token migration to trusted publishing, and creates no tag or GitHub Release.
  - `HV-ADAPTIVE-DEBOUNCE-NPMRC-RAW-TOKEN` — `FIXED`: removed the malformed local credential file and ignored `.npmrc` so bootstrap credentials remain environment-only.
  - `HV-ADAPTIVE-DEBOUNCE-NPM-SCOPE-OWNERSHIP` — `FIXED`: the maintainer confirmed control of the new `Kjaal` npm account and the `@adaptive-debounce` organization, with no other private packages; public-package creation rights remain a prerequisite checked during the first release.
  - `HV-ADAPTIVE-DEBOUNCE-RELEASE-BOOTSTRAP-SCOPE` — `FIXED`: the one-time bootstrap policy uses a one-day granular All Packages read/write token with 2FA bypass and no organization access, stored only in the protected environment and revoked immediately after the first run.
  - `HV-ADAPTIVE-DEBOUNCE-PUBLISH-PARTIAL-RELEASE` — `FIXED`: the shared publication guard skips an existing version only when registry name, version, and SHA-512 integrity exactly match the validated tarball; mismatches and errors stop publication, allowing safe reruns after an interrupted release.
  - `HV-ADAPTIVE-DEBOUNCE-RELEASE-ADMIN-BYPASS` — `PENDING_HUMAN`: decide whether repository administrators may bypass `npm-publish` environment approval; GitHub currently permits bypass.
- [x] `RELEASE-003` Set all four publishable package manifests to the first `0.1.0-rc.1` release candidate, validate the local non-browser release gates, and push the prepared version without publishing, tagging, or creating a GitHub Release. The protected package-only workflow remains the final browser and retained-artifact rehearsal.
  - `HV-ADAPTIVE-DEBOUNCE-MANIFEST-NODE-ENGINE` — `PENDING_HUMAN`: choose the minimum supported Node.js version before adding `engines.node`; publint suggests it for the core, Vue, and React packages, but runtime support is a public contract and must not be guessed.
- [ ] `RELEASE-004` Add a temporary protected manual workflow to remove the unintended `latest` dist-tag from exactly `adaptive-debounce`, `@adaptive-debounce/vue`, `@adaptive-debounce/react`, and `@adaptive-debounce/nuxt`. Acceptance: the `main` and repository guards, exact `remove latest 0.1.0-rc.1` confirmation, read-only permissions, pinned official actions, and `NPM_TOKEN_BOOTSTRAP` environment are enforced; preflight requires only published `0.1.0-rc.1`, `next` exactly `0.1.0-rc.1`, and `latest` exactly `0.1.0-rc.1` or absent; reruns skip already-absent tags, refuse a different `latest`, and verify all four `latest` tags are absent without changing `next` or versions. Remove the temporary workflow only after successful cleanup and registry verification.
  - Exact-version metadata queries and a local-registry fixture cover next-only packages, partial cleanup, already-absent tags, conflicting tags or versions, and a refused deletion. Installation examples explicitly select `@next`, and the security policy records the published release candidate.
  - Run [33120675727](https://github.com/Kjaal/adaptive-debounce/actions/runs/33120675727) passed all four preflights but npm returned `E403` on the first core `latest` deletion. All four packages still have only version `0.1.0-rc.1` and both tags point to it. The refusal's cause is unconfirmed; resolve it for the protected environment's account and credential before retrying. The temporary workflow remains available and no replacement run has been dispatched.
- [x] `DEMO-001` Create a sibling localhost debugging playground after `DEBOUNCE-002` and `BROWSER-003` and before final release-policy work.
  - Completed in `../adaptive-debounce-playground` on `main` at `cc1b3efe`; its type check, production build, and Chromium smoke test pass.
  - Treat the playground as local-only package-testing tooling. Its repository state and release are independent and do not gate packing or publishing this npm package.
  - Keep the package itself framework-neutral and free of runtime dependencies. The playground must consume the existing public API through a local packed artifact or workspace link; do not add debug-only package APIs.
  - Use Vue with Composition API, `<script setup lang="ts">`, and shadcn-vue for the playground UI.
  - Add a simple form whose inputs schedule fake saves. Show the current recommended delay live.
  - Show a bounded event timeline, retaining at most the latest 100 events, for `pending`, `rescheduled`, `fired`, `resolved`, `rejected`, and `explicit-cancel`. Never display or retain input contents in the timeline.
  - Label a pending call replaced by new input as `rescheduled`, not cancelled. Reserve `explicit-cancel` for the cancel control.
  - Add cancel, flush, and adaptive-delay reset controls, and release observers, subscriptions, timers, and pending work during teardown.
  - Keep fake saves local. Add no backend, persistence, network calls, or telemetry.
  - Add a browser smoke test for rescheduling, firing, cancellation, flushing, and live delay updates. Measure playground output separately so it cannot hide a package-size regression.
- [x] `DEMO-002` Extend the sibling debugger with a versioned, privacy-safe **Copy JSON output** snapshot and make timing changes visible. Acceptance: copy the complete bounded latest-100-event snapshot with no form values or other text input; include event-level typing intervals and signed delay deltas; show semantic color and text for events and positive/negative/zero changes; surface clipboard failures; cover the output and color semantics in Chromium; and verify the running localhost server responds without console warnings or errors.
- [x] `DEMO-003` Add a privacy-safe live estimated WPM to the sibling debugger using the package's smoothed typing interval. Acceptance: show the estimate live, reset it with adaptive learning, include it in the copied JSON state, and cover initial, live, reset, and copied-output behavior in Chromium.

### 5. Framework integrations

- [ ] `FRAMEWORK-001` Implement independent companion packages with provisional names `@adaptive-debounce/vue`, `@adaptive-debounce/nuxt`, and `@adaptive-debounce/react`. Acceptance criteria:
  - [x] Create one app-, provider-, or request-scoped `AdaptiveDelay` and typing learner, one client observer, and an optional persistence lifecycle that survives client-side route changes.
  - [x] Preserve per-app, per-request, and per-provider isolation; introduce no package/module mutable singleton; keep deterministic server state and SSR-safe construction.
  - [x] Share the learner and recommended delay, not callback timers. Every helper creates an independent callback-scoped debouncer, promise window, and cancel/flush state, and uses `recordCalls: false` while the shared observer owns typing samples.
  - [x] Provide a Vue plugin plus typed runtime, delay, and debounced-function composables. Component-owned callbacks dispose with their scope; app-owned observation, persistence, timers, and subscriptions dispose when the app unmounts.
  - [x] Provide a Nuxt module installable from `nuxt.config.ts` that registers one universal runtime plugin per Nuxt app/request, reuses the Vue integration, starts client observation only after mounting, survives route changes, and has automated SSR/request-isolation coverage.
  - [x] Provide a React Provider plus typed runtime, delay, and debounced-callback hooks with Provider isolation, independent callback timers, latest-callback behavior, Strict Mode lifecycle coverage, and unmount cancellation.
  - [x] Keep persistence opt-in. When enabled without a custom adapter, use the core persistence entry point's default localStorage provider and fixed same-origin key; never read browser storage during server rendering or initial hydration.
  - [x] Preserve the unchanged framework-neutral root API, zero root runtime dependencies, the documented core size budget, and explicit listener/timer/subscription cleanup.
  - [x] Pass the non-browser framework checks for builds, types, tests, SSR/request isolation, public declarations, publint, packed consumers, and separate adapter size measurements.
  - [ ] `HV-ADAPTIVE-DEBOUNCE-FRAMEWORK-HYDRATION` — `PENDING_HUMAN`: verify actual Nuxt client hydration without mismatch warnings.
  - [ ] `HV-ADAPTIVE-DEBOUNCE-NUXT-HMR-DISPOSED` — `PENDING_HUMAN`: verify live Nuxt HMR leaves one active app runtime and cleans up the replaced runtime.
  - [ ] `HV-ADAPTIVE-DEBOUNCE-REACT-UNCOMMITTED-CALLBACK` — `PENDING_HUMAN`: approve or revise how concurrent renders expose an uncommitted callback to already-pending work.

Dependency order:

```text
WF-002 → PF-003 → CORE-003
CORE-003 → DEBOUNCE-002
CORE-003 → PERSIST-001
PERSIST-001 → PERSIST-002
CORE-003 → BROWSER-002 → BROWSER-003
DEBOUNCE-002 + PERSIST-001 + BROWSER-003 → VERIFY-001
DEBOUNCE-002 + BROWSER-003 → DEMO-001 → DEMO-002
DEMO-002 → CORE-004 (user approval before any timing-model implementation)
CORE-004 → CORE-005 → final release policy
FRAMEWORK-001 → independent Vue, Nuxt, and React companion packages
```

`DEMO-001` through `DEMO-003` describe the local tester and are not dependencies of the npm release.

## Implementation Checklist

### Framework-neutral core

- [x] Expose a DOM-free adaptive timing engine usable in browsers, workers, Node.js, and framework code.
- [x] Keep Vue, React, Svelte, and similar packages out of the core dependency graph.
- [x] Make all entry points safe to import during SSR.
- [x] Avoid import-time listeners, timers, browser-global access, and other side effects.
- [x] Offer a simple way to read or subscribe to the current recommended delay.

### SSR and hydration compatibility

- [x] Treat Nuxt and other SSR/hydration frameworks as first-class consumers rather than optional compatibility targets.
- [x] Allow every public entry point to be imported during SSR, prerendering, and server builds without touching `window`, `document`, DOM constructors, or browser storage.
- [x] Keep the cold-start snapshot deterministic so server rendering and the initial client render cannot disagree.
- [x] Start browser observation only from an explicit client lifecycle and support reliable cleanup on unmount and client-side navigation.
- [x] Defer persisted-profile restoration and all other browser-only state until client execution.
- [x] Keep default-persistence construction server-safe and reject browser-storage operations outside a client lifecycle with custom-adapter guidance.
- [x] Make a browser-observer call on the server throw an actionable error.
- [x] Add a plain Node import-safety test plus a Nuxt SSR/render-and-hydrate consumer fixture with hydration-warning detection.
- [x] Document a Nuxt integration using its client lifecycle without requiring the core package to be wrapped in `ClientOnly` or disabling SSR.

### Typing behavior observation

- [x] Provide an optional browser observer for an input, textarea, editable element, form/root, or document-level scope.
- [x] Require explicit observation; default `root` to the current document only when `observeTyping` is called.
- [x] Handle `input`, deletion, paste, cut, autofill, key repeat, mobile keyboards, and IME composition intentionally.
- [x] Ignore unrelated navigation and modifier activity.
- [x] Support dynamically added and removed fields without leaking references or listeners.
- [x] Return an idempotent cleanup function.
- [x] Never require access to the entered text to calculate timing.

### Adaptive timing model

- [x] Use qualifying inter-record intervals as the only version-one adaptive signal.
- [x] Use a deterministic `750 ms` cold-start delay before enough observations exist.
- [x] Use a robust bounded estimator so outliers do not cause large jumps.
- [x] Smooth delay changes and clamp them to configurable minimum and maximum values.
- [x] Start a new burst after a `2,000 ms` idle gap without erasing the learned interval.
- [x] Keep timing-model memory usage constant.
- [x] Make the clock injectable and use Vitest fake timers for deterministic timer behavior.
- [x] Do not expose WPM or other typing statistics in version one.

### Built-in debounce utility

- [x] Preserve callback arguments, `this`, and awaited result types while returning promises.
- [x] Accept a fixed delay or an adaptive delay provider.
- [x] Support leading, trailing, and hard maximum-wait behavior with trailing-only defaults.
- [x] Provide typed `cancel`, `flush`, and `pending` controls.
- [x] Resample the adaptive delay once per call and reschedule the current window from that call.
- [x] Handle synchronous throws and asynchronous rejection without swallowing errors.
- [x] Allow a hard maximum wait to start a new async invocation without claiming to cancel already-started work; settle windows independently.
- [x] Prevent stale invocations from unexpectedly winning races.

### Interoperability

- [x] Design a small timing-source API that other debounce implementations can sample or subscribe to.
- [x] Document the limitation that third-party debouncers must expose a way to update or recreate their timer; the package cannot mutate every implementation automatically.
- [x] Provide framework-neutral JavaScript and TypeScript examples first.
- [x] Keep framework adapters out of the root package; approved companion packages are tracked by `FRAMEWORK-001`.

### Privacy and safety

- [x] Keep all analysis local and perform no network requests or telemetry.
- [x] Store timing/count metadata only; do not retain input values or individual characters.
- [x] Keep profiles instance-local and expose persistence only through the explicit optional persistence entry point.
- [x] Make persistence opt-in, versioned, resettable, and documented.
- [x] Avoid observing password, payment, one-time-code, or explicitly excluded fields by default.

### Performance and package quality

- [x] Define the 16 kB target as the documented default browser quick-start import, measured after minification and gzip compression.
- [x] Keep that browser import below 16 kB and require explicit approval for regressions over the budget.
- [x] Report raw, minified, gzip, and Brotli sizes in package checks.
- [x] Enforce a `25 us` average built-core record budget after warmup and document tested structural retained-state caps.
- [x] Use zero runtime dependencies.
- [x] Mark side-effect-free modules correctly and verify tree shaking.
- [x] Publish type declarations, source maps, and a clear exports map.
- [x] Emit ES2020 ESM and CommonJS with `.d.mts` and `.d.cts`; verify consumer compatibility before promising a consumer `engines` range.
- [x] Define the published-version policy as Semantic Versioning in `RELEASING.md`.
- [ ] Define an exact runtime and browser-support policy after compatibility has been verified; the ES2020 output target alone is not a support promise.

### Testing

- [x] Use deterministic clocks and fake timers for EWMA arithmetic, bounds, idle bursts, debounce windows, maximum wait, cancellation, flushing, errors, reentrancy, stale timers, and overlap.
- [x] Cover bounded retained state, subscription teardown, atomic corrupt/versioned imports, and reset behavior.
- [x] Cover default localStorage persistence, serialized and coalesced writes, autosave cleanup, clear races, adapter failures, and disposal.
- [x] Add type tests for callback arguments, `this`, awaited results, controls, invalid options, and ESM/CommonJS declaration resolution.
- [x] Add import-safety tests for every public entry point in environments without a DOM.
- [x] Run automated browser tests for dynamic inputs, privacy exclusions, repeated keys, synthetic events, teardown, and server-call errors.
- [ ] Validate trusted autofill and completed IME behavior on real devices using the sibling playground's **Real OS checks** panel (`HV-ADAPTIVE-DEBOUNCE-BROWSER-AUTOFILL`, `HV-ADAPTIVE-DEBOUNCE-BROWSER-IME-COMPLETION`).
- [x] Add a Nuxt server-render-and-hydrate fixture that fails on hydration warnings or server-global access.
- [x] Pack and consume the package from temporary ESM, CommonJS, JavaScript, and TypeScript projects, then run publint against the built exports.
- [x] Enforce the default `adaptiveDebounce` browser quick-start import below `16,000` minified-and-gzipped bytes; report raw and Brotli sizes and measure optional subpaths separately.

### Documentation and release

- [x] Write a one-minute quick start for the built-in debounce utility.
- [x] Write a separate browser-observer example with cleanup.
- [x] Write an SSR/hydration guide and a Nuxt lifecycle example.
- [x] Explain what is measured, what is never collected, and how the delay is calculated.
- [x] Document all defaults, edge behavior, errors, async semantics, and escape hatches.
- [x] Add `changelog.md`.
- [x] Add the approved MIT license and matching public package metadata.
- [x] Add concise contribution, security, and code-of-conduct files, with hosted contact details intentionally deferred until a repository exists.
- [x] Configure CI for formatting, linting, type checks, tests, builds, package checks, performance, and size checks.
- [x] Dry-run the packed npm artifact and test it from clean ESM, CommonJS, JavaScript, and TypeScript consumers.

## Approved v1 Decisions

### Package foundation (`PF-001`, `PF-002`)

- Use Node.js `22.18+` for contributor tooling and pnpm for package management.
- Use TypeScript `7.0.2`, tsdown `0.22.14`, Vitest `4.1.11`, Biome `2.5.10`, publint `0.3.24`, and esbuild `0.28.2` with no runtime dependencies.
- Emit ES2020 ESM and CommonJS plus `.d.mts` and `.d.cts`, and mark the package `sideEffects: false`.
- Do not add a consumer `engines` promise until release compatibility is verified.
- Measure the documented default browser quick-start import after minification and gzip compression against the `16,000` byte limit; report raw and Brotli sizes for context.

### Root API and adaptive delay (`CORE-001`, `CORE-002`)

```ts
import { adaptiveDebounce, createAdaptiveDelay } from 'adaptive-debounce'

const save = adaptiveDebounce(saveItemMethod)
const fixedSave = adaptiveDebounce(saveItemMethod, 300)
const sharedDelay = createAdaptiveDelay()
const sharedSave = adaptiveDebounce(saveItemMethod, sharedDelay)
const observedSave = adaptiveDebounce(saveItemMethod, {
  delay: sharedDelay,
  recordCalls: false,
  leading: true,
  trailing: true,
  maxWait: 2_000,
})
```

- The root exports `createAdaptiveDelay`, `adaptiveDebounce`, and their public types. It exports no mutable singleton and no plain `debounce` alias.
- Pass the callback itself to `adaptiveDebounce`; do not invoke it while constructing the wrapper.
- `AdaptiveDelay` exposes `record()`, `getDelay()`, `reset()`, `subscribe()`, `exportState()`, and `importState()`.
- Defaults are minimum `500 ms`, initial `750 ms`, maximum `1,500 ms`, smoothing `0.25`, interval multiplier `5`, quiet period `350 ms`, and idle reset `2,000 ms`.
- Use a constant-memory clipped EWMA: derive a cold cadence prior from `(initialDelayMs - quietPeriodMs) / intervalMultiplier`, clamp each interval to `0.5×–2×` the current estimate, smooth the first accepted interval with the full configured weight, then curve mature weights as `smoothing / (1 + 2 × relative error)`. Multiply the result by `5`, add the `350 ms` quiet period, then clamp to the configured delay bounds.
- The first record establishes a monotonic baseline. Ignore equal timestamps, begin a new burst after an idle gap without erasing learning, and reject regressing or non-finite clocks.
- Notify subscribers synchronously after exportable state changes. State remains committed if a listener fails; run every listener for the current state, then rethrow the first error. A reentrant state change supersedes the remaining notifications of older state. Teardown is idempotent.
- `AdaptiveDelayStateV1` is exactly `{ version: 1, smoothedIntervalMs: number | null }` and contains no text, identity, raw observations, or timestamps.
- `importState(unknown)` validates atomically and returns `imported`, `invalid`, or `unsupported-version`; rejected input leaves current state untouched.

### Adaptive debounce (`CORE-001`, `DEBOUNCE-001`)

- Accept a numeric delay, an `AdaptiveDelay`, or options containing `delay`, `recordCalls`, `leading`, `trailing`, and `maxWait`. Omitted delay creates a private adaptive instance; shared adaptive delays record calls by default; numeric delays create no adaptive state.
- Preserve callback arguments, `this`, and the awaited result type while normalizing every call to `Promise<Awaited<Result>>`.
- Default to trailing execution without a maximum wait. Calls in one window share one promise, retain the latest arguments and `this`, and resample adaptive delay once per call.
- Support leading, trailing, both together, hard `maxWait`, `cancel(reason?)`, `flush()`, and `pending()`. With leading and trailing together, run the trailing call only when another call joins the window; the shared promise resolves to the final invocation result.
- Reject the window promise on callback throws or rejections. Cancellation rejects with the supplied reason or a default `AbortError`.
- A hard maximum wait may overlap an older async invocation. Windows settle independently, and already-started side effects are not treated as cancellable.

### Optional subpaths (`BROWSER-001`, `PERSIST-001`, `PERSIST-002`)

- `adaptive-debounce/persistence` exports a sync-or-async storage adapter and `createAdaptiveDelayPersistence` without re-exporting them from the root.
- Omitting the adapter uses browser localStorage under the fixed same-origin `adaptive-debounce:state` key. Imports and factory construction remain SSR-safe; storage operations resolve the browser global lazily and otherwise reject with client-lifecycle and custom-adapter guidance.
- Persistence always exposes manual `load`, `save`, `flush`, and `clear`. Autosave is opt-in, trailing at `1,000 ms`, and requires an error callback; writes serialize and coalesce.
- `clear()` resets memory immediately and prevents older queued writes from restoring deleted state. `dispose()` removes subscriptions and timers without implicitly saving.
- The built-in adapter stores only version-one timing state and does not auto-load, auto-save, synchronize tabs, or make network requests. Custom adapters remain the path for scoped keys, consent, authentication, and other storage locations.
- `adaptive-debounce/browser` exports `observeTyping(delay, { root? })` without re-exporting it from the root. Importing is SSR-safe; calling it without a browser throws clearly; omitted `root` resolves to the current document at call time.
- Observe trusted typed insertions in eligible text controls and contenteditable roots. Ignore paste, deletion, autofill, undo, synthetic input, repeated keys, and intermediate IME events; record completed composition once. Never read values or input data. Follow [Input Events Level 2](https://www.w3.org/TR/input-events-2/) and the [UI Events composition model](https://w3c.github.io/uievents/split/composition-events.html).
- When browser observation and debounce share an adaptive-delay instance, configure debounce with `recordCalls: false`.
- Keep the root dependent only on adaptive delay and debounce; optional subpaths depend only on the public `AdaptiveDelay` contract. Instance-owned state prevents ESM and CommonJS consumers from sharing an accidental singleton.

### Deferred beyond version one

- No WPM API, root-package framework adapters, telemetry, UI-purpose presets, animation-preference claims, or actual load-time manipulation. The approved Vue, Nuxt, and React companion packages are tracked by `FRAMEWORK-001`.
- npm scope ownership, browser-support policy, actual publication, and any tag or GitHub Release remain explicit human release decisions; checked-in automation does not perform them automatically.

## Suggested Milestones

### 0. Product contract

- [x] Resolve the initial version-one contract decisions in `WF-002`.
- [x] Record the public API sketch and behavioral examples in `WF-002`.
- [x] Define version-one acceptance criteria and non-goals in `WF-002`.

### 1. Package foundation

- [x] Initialize a local Git repository with `main` as the initial branch.
- [x] Initialize the private pnpm manifest and lockfile foundation.
- [x] Add TypeScript, build, test, lint, format, and size tooling after their runtime/output implications are approved.
- [x] Add strict TypeScript, build, lint, format, test, and type-test configuration.
- [x] Establish exports and a package-consumer fixture.

### 2. Adaptive timing core

- [x] Implement the bounded statistics/profile state.
- [x] Implement and test the delay recommendation policy.
- [x] Expose snapshots and timing-source integration without DOM dependencies.

### 3. Debounce state machine

- [x] Implement fixed and adaptive delay support.
- [x] Add leading/trailing/max-wait controls and lifecycle methods.
- [x] Complete async, cancellation, abort, and error semantics.

### 4. Browser observer

- [x] Implement explicit observation and teardown.
- [x] Cover browser input edge cases, exclusions, and dynamic DOM behavior in automated tests.
- [x] Verify privacy and structural memory constraints.

### 5. Integration and release candidate

- [x] Write framework-neutral docs and a Nuxt lifecycle recipe.
- [x] Verify bundle, package contents, compatibility, and consumer projects.
- [x] Dry-run the packed artifact from clean consumers.
- [ ] Complete release documentation after npm scope, repository visibility, versioning, browser-support, publishing, and release policies are approved.

## Project Skills

- `coding-standards` (installed): baseline readability, testing, naming, and maintainability rules.
- `typescript-advanced-types` (installed): public generic callback types, inference, and compile-time tests; use carefully to keep types understandable.
- `nuxt4-patterns` (installed): SSR-safe imports, deterministic hydration, and Nuxt integration guidance.
- `playwright` (installed): real-browser verification for input events, cleanup, and hydration behavior.
- `security-best-practices` (installed): privacy and security review for browser input observation and optional persistence.
- `vitest` (installed, third-party MIT skill): framework-neutral unit tests, fake timers, type assertions, and coverage setup.
- `vue-best-practices` plus `vue` (installed): use only when creating or verifying a Vue or Nuxt recipe or adapter.
- No React- or Svelte-specific skill is currently available in this workspace; use their official documentation if those integrations become part of the approved scope.
