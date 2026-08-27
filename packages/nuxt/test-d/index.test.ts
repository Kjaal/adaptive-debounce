import type { NuxtConfig } from '@nuxt/schema'
import type { AdaptiveDebounceNuxtOptions } from '../src/module'

const options: AdaptiveDebounceNuxtOptions = {
  delay: {
    minimumDelayMs: 500,
    initialDelayMs: 800,
    maximumDelayMs: 1_600,
    smoothing: 0.2,
    intervalMultiplier: 5,
    quietPeriodMs: 350,
    idleResetMs: 2_000,
  },
  observe: true,
  persistence: false,
}
void options

const config: NuxtConfig = {
  modules: ['@adaptive-debounce/nuxt'],
  adaptiveDebounce: options,
}
void config

const invalid: AdaptiveDebounceNuxtOptions = {
  delay: {
    // @ts-expect-error Nuxt configuration must remain serializable
    clock: () => 1,
  },
}
void invalid

const invalidObserve: AdaptiveDebounceNuxtOptions = {
  // @ts-expect-error observation is configured with a boolean in nuxt.config
  observe: {},
}
void invalidObserve
