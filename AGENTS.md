# Project Instructions

## Mission

Build a small, framework-agnostic TypeScript package that learns from local typing timing and supplies a stable adaptive delay to debounce workflows. It must work without Vue, React, Svelte, or any other framework dependency, including SSR and hydration-based applications such as Nuxt. Package weight is a critical product constraint: aim to keep the documented default browser quick-start import below 16 kB after minification and gzip compression.

## Working Agreement

- Work in small, reviewable increments and keep explanations concise.
- Ask the user before making decisions that materially affect the public API, package tooling, runtime support, adaptive algorithm, privacy model, persistence, dependencies, or release process.
- Prefer the simplest design that satisfies a demonstrated requirement. Do not add speculative framework adapters or abstractions.
- Treat local `todo.md` as the canonical internal plan and keep it current when requirements or decisions change. Planning notes are ignored by Git; never stage or publish them.
- Do not publish packages, create remote repositories, commit, or push unless the user explicitly asks.

## Turn Protocol

1. Before work, read local `todo.md` and select one scheduled task ID. On a fresh checkout without it, create the local plan from the current explicit request; do not infer older tasks. A task is planned only when it is present at the start of the turn or explicitly requested in the current turn.
2. Keep the turn limited to that one small task. Add a new scheduled task ID only when the current user request explicitly schedules it.
3. After work, reconcile the selected item in `todo.md`, checking it off only when its acceptance criteria are met.
4. Record public changes under `changelog.md` > `Unreleased` with the same task ID and a concise description. Keep internal coordination and planning details only in local `todo.md`.
5. Do not execute newly discovered or otherwise unscheduled work. It may be recorded in `todo.md`, but must be surfaced through the ARSE guard as `HUMAN_VALIDATION` / `PENDING_HUMAN` with a stable `HV-ADAPTIVE-DEBOUNCE-...` finding ID.

## Product Boundaries

- Keep the adaptive timing engine and debounce implementation independent of the DOM.
- Put browser input observation behind a separate, optional entry point.
- Do not install global listeners or access browser globals at module-import time.
- Keep every public entry point safe to import during SSR, prerendering, and server builds. Importing the package must not require `window`, `document`, storage, or a client-only wrapper.
- Start browser observation only through an explicit client-lifecycle call, and make teardown safe during component unmounts and client-side route changes.
- Keep cold-start state deterministic across server rendering and initial hydration. Defer browser storage and persisted-profile reads until client execution.
- By default, never retain, expose, log, or transmit input text. Typing analysis should use timing and non-content metadata only.
- Use bounded state. Long sessions must not cause unbounded memory growth.
- Treat the 16 kB minified-and-gzipped browser-import target as a design constraint. Do not add runtime dependencies or substantial feature weight without reporting the size impact and obtaining user approval.
- Provide explicit teardown for every listener, timer, and subscription.
- Make server-side import safe, even when browser-only features are unavailable.
- Do not add network behavior or telemetry.

## TypeScript and API Standards

- Enable strict TypeScript checking and avoid `any`; use `unknown` with narrowing when necessary.
- Preserve callback arguments, `this`, and awaited result types in public utilities while deliberately normalizing wrapper calls to promises.
- Prefer readonly public data and immutable updates unless measured performance requires otherwise.
- Keep public types understandable; avoid clever conditional types that harm editor performance or error messages.
- Document every public export with concise JSDoc and a usage example where helpful.
- Make defaults explicit, validated, and safe. Reject invalid configuration with actionable errors.
- Avoid import-time side effects and keep entry points tree-shakeable.

## Behavioral Standards

- Use a monotonic clock for duration measurements.
- Clamp adaptive delays to configured minimum and maximum bounds.
- Smooth timing changes so a single unusual keystroke cannot cause erratic debounce behavior.
- Define cold-start, idle-reset, paste, deletion, key-repeat, autofill, and IME composition behavior in tests before considering the feature complete.
- Define async concurrency and cancellation semantics explicitly; do not allow stale work or unhandled rejections by accident.

## Verification

- Test observable behavior rather than implementation details.
- Use deterministic fake clocks/timers for timing tests.
- Add runtime tests, public type tests, browser-observer tests, and async race/cancellation tests.
- Add an SSR import test and a Nuxt hydration smoke test that fails on server-global access or hydration warnings.
- Add leak-oriented tests that verify timers, listeners, and retained samples are bounded and cleaned up.
- Track bundle size once build tooling is approved. Enforce the 16 kB limit against the documented default browser quick-start import after minification and gzip compression; report raw and Brotli sizes for context.
- Treat exceeding the size budget or increasing an already-over-budget build as a failing check unless the user explicitly approves it.
- Run the repository's formatting, linting, type-checking, test, and build scripts before declaring a code change complete.

## Documentation

- Keep the quick start framework-neutral.
- Clearly distinguish the DOM-free core from optional browser observation.
- Document SSR/hydration usage and provide a Nuxt lifecycle example without making Nuxt a runtime dependency.
- Document privacy behavior, timing methodology, cleanup, cancellation, and async error behavior.
- Include plain JavaScript and TypeScript examples before framework-specific examples.

## Definition of Done

A task is done when its behavior and edge cases are documented, implementation and public types agree, relevant automated checks pass, cleanup is verified, and `todo.md` reflects the result.
