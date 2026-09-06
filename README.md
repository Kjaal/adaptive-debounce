# adaptive-debounce

A small, framework-neutral debounce utility that adapts to local interaction cadence. The core is
DOM-free and safe to import during SSR. Browser observation and persistence are separate, optional
entry points.

## Install

```sh
npm install adaptive-debounce@next
```

The published `0.1.0-rc.1` release candidate uses the `next` channel; no stable release is available.

## Quick start

### JavaScript

```js
import { adaptiveDebounce } from 'adaptive-debounce'

async function saveDraft(draft) {
  return api.save(draft)
}

const saveLater = adaptiveDebounce(saveDraft)

try {
  await saveLater({ title: 'Latest title' })
} catch (error) {
  // Handle save failures and cancellation here.
}
```

Pass the callback itself: `adaptiveDebounce(saveDraft)`, not
`adaptiveDebounce(saveDraft())`. The default starts at `750 ms`, learns from calls, and runs on the
trailing edge.

### TypeScript

```ts
import { adaptiveDebounce, createAdaptiveDelay } from 'adaptive-debounce'

const delay = createAdaptiveDelay()
const saveLater = adaptiveDebounce(
  async (documentId: string, revision: number): Promise<string> => {
    return saveRevision(documentId, revision)
  },
  delay,
)

const savedRevision = await saveLater('guide', 4)
console.log(delay.getDelay(), savedRevision)
```

Arguments, `this`, and the awaited result type are preserved. Calls always return promises.

Use a fixed delay when adaptation is not needed:

```js
const saveLater = adaptiveDebounce(saveDraft, 300)
```

## Framework packages

Install one companion package at the application root when Vue, Nuxt, or React should own the
typing learner for you:

| Application | Package | Install once |
| --- | --- | --- |
| Vue 3 | `@adaptive-debounce/vue` | `app.use(createAdaptiveDebouncePlugin())` |
| Nuxt 4 | `@adaptive-debounce/nuxt` | Add the module in `nuxt.config.ts` |
| React 18 or 19 | `@adaptive-debounce/react` | Render `AdaptiveDebounceProvider` above the router |

Each application receives one isolated learner and browser observer. Every debounced callback still
has its own timer, arguments, promise, and cancel/flush controls, so typing in one form cannot cancel
another form's save. There is no module-global runtime or cross-request state.

### Vue

```sh
npm install adaptive-debounce@next @adaptive-debounce/vue@next
```

```ts
import { createAdaptiveDebouncePlugin } from '@adaptive-debounce/vue'

app.use(createAdaptiveDebouncePlugin({ persistence: true }))
```

Use `useAdaptiveDebouncedFn(saveDraft)` in any component. The `@adaptive-debounce/vue` package
README covers its complete lifecycle and persistence controls.

### Nuxt

```sh
npm install adaptive-debounce@next @adaptive-debounce/vue@next @adaptive-debounce/nuxt@next
```

```ts
export default defineNuxtConfig({
  modules: ['@adaptive-debounce/nuxt'],
  adaptiveDebounce: { persistence: true },
})
```

The module auto-imports `useAdaptiveDebouncedFn`, `useAdaptiveDelay`, and
`useAdaptiveDebounceRuntime`. The `@adaptive-debounce/nuxt` package README covers module options and
advanced setup.

### React

```sh
npm install adaptive-debounce@next @adaptive-debounce/react@next
```

```tsx
<AdaptiveDebounceProvider persistence>
  <RouterProvider router={router} />
</AdaptiveDebounceProvider>
```

Use `useAdaptiveDebouncedCallback(saveDraft)` in any descendant. The `@adaptive-debounce/react`
package README covers Provider options and persistence controls.

The app-owned learner survives client-side route changes. Persistence is opt-in: enabling it loads
and autosaves timing metadata through the core package's default same-origin `localStorage`
provider, so learning can also survive a hard reload. No package reads or stores input text.

Component-owned callbacks are cancelled, not flushed, during teardown. If navigation must wait for
a pending save, call and await that callback's `flush()` before navigating. App-owned observation,
persistence timers, and subscriptions are stopped when the application owner unmounts.

## Browser observation

Use the optional browser entry point when the delay should learn from typing rather than wrapper
calls:

```js
import { adaptiveDebounce, createAdaptiveDelay } from 'adaptive-debounce'
import { observeTyping } from 'adaptive-debounce/browser'

const delay = createAdaptiveDelay()
const saveLater = adaptiveDebounce(saveDraft, {
  delay,
  recordCalls: false,
})
const stopObserving = observeTyping(delay)

console.log(delay.getDelay())

// On unmount or route teardown:
stopObserving()
saveLater.cancel()
```

`observeTyping()` uses delegated listeners, so it also covers fields added later. Pass a `Document`
or `Element` as `root` to limit the observed area. Cleanup is idempotent.

The observer records trusted typed insertions in eligible text controls. It ignores paste,
deletion, autofill, undo, key repeat, synthetic events, and intermediate IME events. Password
inputs and controls whose standardized `autocomplete` tokens identify password, one-time-code, or
payment data are excluded. Custom sensitive fields cannot be inferred: add
`data-adaptive-debounce-ignore` to any control or ancestor that should not be observed.

## Controls and async behavior

```js
saveLater.pending() // true while a debounce window is open
saveLater.flush() // run the pending trailing call now
saveLater.cancel() // reject the pending window with an AbortError
saveLater.cancel(reason) // reject it with a custom reason
```

Calls in one window share one promise and use the latest arguments. A new call reschedules that
window; it is not an explicit cancellation. Synchronous throws and asynchronous rejections reject
the shared promise.

`cancel()` cannot stop work that has already started. A configured `maxWait` can start a newer
async invocation while an older one is still running, and each window settles independently.

## State and third-party debouncers

Use `getDelay()` with another debounce implementation when it can accept a new wait value. Subscribe
when an already-pending timer should follow later recommendations:

```js
import { createAdaptiveDelay } from 'adaptive-debounce'

const delay = createAdaptiveDelay()
let timer

async function savePendingDraft() {
  return api.save(getCurrentDraft())
}

function scheduleSave() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void savePendingDraft().catch((error) => {
      console.error('Could not save draft', error)
    })
  }, delay.getDelay())
}

const unsubscribe = delay.subscribe(() => {
  if (timer !== undefined) scheduleSave()
})

scheduleSave() // Call whenever the application has new work to debounce.

// Later, during teardown:
unsubscribe()
clearTimeout(timer)
```

`subscribe()` reports future state changes; it does not call the listener immediately. The package
cannot mutate a third-party debouncer's active timer. Reschedule it as above, or cancel and recreate
its pending timer/window if that library does not support updating the wait.

`exportState()` returns a fresh privacy-safe snapshot. Restore it with `importState(snapshot)`,
which returns `imported`, `invalid`, or `unsupported-version` without partially applying rejected
input. `reset()` clears learned timing and returns the instance to its configured cold start. Both
an accepted import and reset notify subscribers when the exported state changes.

## SSR and manual framework integration

Every entry point is safe to import during SSR and prerendering. The companion packages handle the
client lifecycle automatically. When using the core directly, start browser observation and load
persisted state only during client execution.

```vue
<script setup lang="ts">
import { adaptiveDebounce, createAdaptiveDelay } from 'adaptive-debounce'
import { observeTyping } from 'adaptive-debounce/browser'
import { onMounted, onUnmounted } from 'vue'

const delay = createAdaptiveDelay()
const search = adaptiveDebounce(
  (query: string) => $fetch('/api/search', { query: { q: query } }),
  { delay, recordCalls: false },
)

let stopObserving = () => {}

onMounted(() => {
  stopObserving = observeTyping(delay)
})

onUnmounted(() => {
  stopObserving()
  search.cancel()
})
</script>
```

No `ClientOnly` wrapper or disabled SSR is needed. The cold-start state is deterministic on the
server and client.

## Privacy and persistence

Adaptive timing and browser observation use timing metadata only. They never read input values or
`InputEvent.data`, and the exported state contains only a version and one smoothed interval. The
package has no telemetry, network behavior, or runtime dependencies.

Like any debounce utility, the wrapper keeps the latest callback arguments until its pending
window settles or is cancelled. Keep secrets out of callback arguments when that matters.

Persistence is opt-in through `adaptive-debounce/persistence`. With no adapter, it uses browser
`localStorage` under the fixed same-origin key `adaptive-debounce:state`. Creating the controls is
SSR-safe; when using the built-in adapter, call `load()`, `save()`, and `clear()` only during client
execution.

```js
import { createAdaptiveDelay } from 'adaptive-debounce'
import { createAdaptiveDelayPersistence } from 'adaptive-debounce/persistence'

const delay = createAdaptiveDelay()
const persistence = createAdaptiveDelayPersistence(delay, {
  autosave: {
    onError(error) {
      console.error('Could not save adaptive timing', error)
    },
  },
})

// Run from your browser or framework client-mount lifecycle.
await persistence.load()

// On teardown:
persistence.dispose()
```

Loading and saving are explicit unless autosave is enabled. Without autosave, call
`await persistence.save()` when you want to keep the current profile. Autosave waits `1,000 ms`
after the latest timing change. Manual storage failures reject their promise; background failures
go to `onError`.

The package does not prompt for storage consent. Load, save, or enable autosave only when your
application's policy permits it.

`localStorage` is browser-managed, not garbage-collected when JavaScript objects are released. It
survives same-origin navigation and browser restarts until `clear()`, site-data removal, or browser
policy removes it. Pages using the fixed key see the latest value when they call `load()`; writes
are last-write-wins and open tabs are not synchronized live.

Pass a custom adapter for per-user, per-form, or per-tenant keys, another backend, or a different
consent policy:

```js
const persistence = createAdaptiveDelayPersistence(delay, profileAdapter)
```

Custom adapters own their keys, serialization, access control, and storage. `dispose()` stops
autosave without saving or clearing data.

## Defaults and options

The adaptive delay defaults to a `500-1,500 ms` range, a `750 ms` cold start, a `5×` interval
multiplier, a `350 ms` quiet period, and a `2,000 ms` idle reset. After the first timing sample,
the recommendation is the estimated five-character word time plus the quiet period, clamped to the
configured bounds. This is a timing heuristic, not content or punctuation detection: the package
never reads the input to decide whether a sentence is complete.

Before a qualifying interval exists, `getDelay()` stays at `initialDelayMs`. The first interval is
compared with a derived cold cadence prior, clipped to the same `0.5×-2×` range as later samples,
and smoothed with the full configured `smoothing` weight so learning starts quickly. For later
intervals, `smoothing` is the maximum weight: a reciprocal relative-error curve gives larger
changes less weight while similar intervals settle quickly. This keeps mature recommendations from
jumping with a single unusually fast or slow interval. Finite options remain accepted
independently; if their inverse prior is non-positive or non-finite, the default `80 ms` cadence
prior is used for that first sample.

Configure `createAdaptiveDelay()` when a workflow needs different bounds or timing behavior:

```ts
const delay = createAdaptiveDelay({
  minimumDelayMs: 500,
  initialDelayMs: 750,
  maximumDelayMs: 1_500,
  intervalMultiplier: 5,
  quietPeriodMs: 350,
})
```

Configure `adaptiveDebounce()` with `leading`, `trailing`, `maxWait`, and `recordCalls` when the
debounce lifecycle does not fit the defaults.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development and review expectations. Report
suspected vulnerabilities privately as described in [SECURITY.md](./SECURITY.md), not in a public
issue.

## License

[MIT](./LICENSE)
