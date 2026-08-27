import {
  adaptiveDebounceKey,
  type AdaptiveDebounceRuntime,
  createAdaptiveDebouncePlugin,
} from '@adaptive-debounce/vue'
import { defineNuxtPlugin, type NuxtApp, useRuntimeConfig } from 'nuxt/app'
import { inject } from 'vue'
import type { AdaptiveDebounceNuxtOptions } from './options.js'

type RuntimeNuxtApp = Pick<NuxtApp, 'hook' | 'vueApp'>

interface HotImportMeta {
  readonly hot?: {
    dispose(callback: () => void): void
  }
}

/** Installs one isolated Vue runtime and schedules its client-only start. */
export function installNuxtAdaptiveDebounce(
  nuxtApp: RuntimeNuxtApp,
  options: AdaptiveDebounceNuxtOptions,
): AdaptiveDebounceRuntime {
  const existing = getInstalledRuntime(nuxtApp)
  if (existing) {
    return existing
  }

  nuxtApp.vueApp.use(
    createAdaptiveDebouncePlugin({
      ...(options.delay ? { delay: options.delay } : {}),
      observe: options.observe === false ? false : {},
      persistence: options.persistence ?? false,
      autoStart: false,
      onError: reportAutomaticError,
    }),
  )

  const runtime = getInstalledRuntime(nuxtApp)
  if (!runtime) {
    throw new Error('Failed to install the adaptive-debounce Vue runtime.')
  }

  nuxtApp.hook('app:mounted', () => {
    if (typeof document !== 'undefined') {
      void runtime.start().catch(reportAutomaticError)
    }
  })

  const hot = (import.meta as ImportMeta & HotImportMeta).hot
  hot?.dispose(runtime.dispose)
  return runtime
}

export default defineNuxtPlugin((nuxtApp) => {
  const options = useRuntimeConfig().public.adaptiveDebounce ?? {}
  return {
    provide: {
      adaptiveDebounce: installNuxtAdaptiveDebounce(nuxtApp, options),
    },
  }
})

function getInstalledRuntime(nuxtApp: RuntimeNuxtApp): AdaptiveDebounceRuntime | undefined {
  return nuxtApp.vueApp.runWithContext(() => inject(adaptiveDebounceKey, undefined))
}

function reportAutomaticError(error: unknown): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('Adaptive debounce background operation failed.', error)
  }
}
