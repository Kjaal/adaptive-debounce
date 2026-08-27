# @adaptive-debounce/react

React Provider and hooks for [`adaptive-debounce`](https://www.npmjs.com/package/adaptive-debounce).

## Install

```sh
npm install adaptive-debounce @adaptive-debounce/react
```

## Set up once

Place the Provider above your router. It creates one typing learner for the application while each
debounced callback keeps an independent timer.

```tsx
import { AdaptiveDebounceProvider } from '@adaptive-debounce/react'

root.render(
  <AdaptiveDebounceProvider>
    <RouterProvider router={router} />
  </AdaptiveDebounceProvider>,
)
```

Browser observation starts after the Provider mounts and is cleaned up when it unmounts. Disable it
with `observation={false}`, or scope it with `observation={{ root: formElement }}`.

Keep the Provider above the router to preserve one learner across client-side routes. Without
persistence, a hard reload starts a new cold profile.

## Debounce a callback

```tsx
import { useAdaptiveDebouncedCallback } from '@adaptive-debounce/react'

function ProfileForm() {
  const save = useAdaptiveDebouncedCallback(async (profile: Profile) => {
    await updateProfile(profile)
  })

  return <ProfileFields onChange={(profile) => void save(profile).catch(reportSaveError)} />
}
```

Calls to different hooks never cancel each other. A hook cancels its own pending call with an
`AbortError` when its component unmounts. Await or catch returned promises. If navigation must wait
for a pending save, explicitly call and await `save.flush()` before navigating.

Use `useAdaptiveDelay()` when you need to display the current recommendation:

```tsx
const delayMs = useAdaptiveDelay()
```

## Keep learning across page loads

Persistence is opt-in. `persistence` loads the privacy-safe timing profile from the core package's
built-in `localStorage` adapter and autosaves changes after one second.

```tsx
<AdaptiveDebounceProvider persistence onError={reportError}>
  <App />
</AdaptiveDebounceProvider>
```

Pass an application-owned adapter when you need another storage policy:

```tsx
<AdaptiveDebounceProvider persistence={{ adapter: profileAdapter }}>
  <App />
</AdaptiveDebounceProvider>
```

`useAdaptiveDebounceRuntime()` exposes `load()`, `flush()`, and `clear()` for explicit persistence
operations. They reject when persistence is disabled or when storage fails.

## SSR and privacy

The package does not read `window`, `document`, or storage during import or server rendering. The
server snapshot is the Provider's deterministic cold delay; persisted state loads only after mount.
Each Provider owns its runtime, so separate applications and SSR requests cannot share learning.
The package does not create a module-global runtime.

The observer records timing metadata only. It never reads input values or event text, ignores
synthetic events and non-typing edits, and follows the core package's sensitive-control exclusions.
