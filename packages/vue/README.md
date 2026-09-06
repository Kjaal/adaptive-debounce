# @adaptive-debounce/vue

Install adaptive debounce once for a Vue application. Every component shares one learned typing
profile, while each debounced callback keeps its own timer, arguments, promise, and cancellation.

## Install

```sh
npm install adaptive-debounce@next @adaptive-debounce/vue@next
```

## Set up once

```ts
import { createApp } from 'vue'
import { createAdaptiveDebouncePlugin } from '@adaptive-debounce/vue'
import App from './App.vue'

createApp(App)
  .use(createAdaptiveDebouncePlugin())
  .mount('#app')
```

Observation is enabled by default. Persistence is not. Enable same-origin localStorage explicitly:

```ts
app.use(createAdaptiveDebouncePlugin({ persistence: true }))
```

The built-in provider loads when the runtime starts and saves one second after learned timing
changes. It stores timing metadata only, never input values.

Calling `runtime.persistence.clear()` resets learning without stopping observation. If startup is
still loading a profile, that profile is discarded and observation starts when the load settles.

## Use anywhere

```ts
import { useAdaptiveDebouncedFn, useAdaptiveDelay } from '@adaptive-debounce/vue'

const delayMs = useAdaptiveDelay() // Readonly ref; templates unwrap it automatically.
const saveDraft = useAdaptiveDebouncedFn(async (draft: Draft) => {
  await api.saveDraft(draft)
})

void saveDraft(draft)
```

Component teardown cancels that component's pending callback. It does not flush it. Other
components keep their own pending work. Call and await `saveDraft.flush()` before navigation when a
pending save must finish first.

Install the plugin above the router to keep one learner across client-side routes. Enable
`persistence` to restore the timing profile after a hard reload; without it, learning lasts only for
that application instance. Neither mode reads or stores input text.

## SSR

Importing and installing the plugin is SSR-safe. Automatic startup waits until `app.mount()` returns,
including functional roots, keeping the initial root hydration state deterministic even when startup awaits router readiness.
Browser observation and opted-in localStorage loading then start once for that app. Set
`autoStart: false` to own startup explicitly through `runtime.start()` after hydration.
Each Vue application receives a separate runtime, so server requests do not
share learned state. No module-global runtime is created.

For Nuxt, use `@adaptive-debounce/nuxt` instead of wiring client lifecycle hooks yourself.
