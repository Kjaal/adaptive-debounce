# @adaptive-debounce/nuxt

Install adaptive debounce once for a Nuxt application. The module creates one request-safe runtime
per Nuxt app, starts typing observation after client mount, and auto-imports the Vue composables.

## Install

```sh
npm install adaptive-debounce @adaptive-debounce/vue @adaptive-debounce/nuxt
```

## Configure

```ts
export default defineNuxtConfig({
  modules: ['@adaptive-debounce/nuxt'],
  adaptiveDebounce: {
    persistence: true,
    delay: {
      minimumDelayMs: 600,
      maximumDelayMs: 1_800,
    },
  },
})
```

Observation is enabled by default. Persistence is opt-in and uses same-origin localStorage with a
one-second trailing save. Only timing metadata is stored; input values are never read or saved.

## Use anywhere

The module auto-imports `useAdaptiveDebounceRuntime`, `useAdaptiveDelay`, and
`useAdaptiveDebouncedFn`:

```vue
<script setup lang="ts">
const delayMs = useAdaptiveDelay()
const saveDraft = useAdaptiveDebouncedFn(async (draft: Draft) => {
  await api.saveDraft(draft)
})
</script>
```

Each composable-created callback has an independent timer. The learned delay and persisted profile
are shared across client-side route changes. The same runtime is also available as
`useNuxtApp().$adaptiveDebounce`.

Route-component teardown cancels that component's pending callback without flushing it. Call and
await the callback's `flush()` before navigation when the save must finish first. With persistence
disabled, the learned profile survives route changes but not a hard reload.

## SSR and advanced setup

The universal plugin creates a fresh cold runtime for each Nuxt app or server request. It does not
touch `document` or localStorage during server rendering, and starts only on `app:mounted` in the
browser. It does not use a module-global runtime.

Nuxt configuration stays serializable. For a custom persistence adapter, observation root, or error
handler, install `@adaptive-debounce/vue` directly from a Nuxt plugin instead.
