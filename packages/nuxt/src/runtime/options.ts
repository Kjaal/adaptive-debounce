import type { AdaptiveDelayOptions } from 'adaptive-debounce'

/** Serializable adaptive-delay options supported by the Nuxt module. */
export type AdaptiveDebounceNuxtDelayOptions = Omit<AdaptiveDelayOptions, 'clock'>

/** Configuration for the `adaptiveDebounce` key in `nuxt.config.ts`. */
export interface AdaptiveDebounceNuxtOptions {
  /** Numeric timing configuration shared by the Nuxt application. */
  readonly delay?: AdaptiveDebounceNuxtDelayOptions
  /** Enables delegated browser typing observation. @defaultValue true */
  readonly observe?: boolean
  /** Enables the built-in localStorage profile. @defaultValue false */
  readonly persistence?: boolean
}
