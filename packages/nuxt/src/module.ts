import { createAdaptiveDelay } from 'adaptive-debounce'
import type { AdaptiveDebounceRuntime } from '@adaptive-debounce/vue'
import { addImports, addPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import type {
  AdaptiveDebounceNuxtDelayOptions,
  AdaptiveDebounceNuxtOptions,
} from './runtime/options.js'

export type {
  AdaptiveDebounceNuxtDelayOptions,
  AdaptiveDebounceNuxtOptions,
} from './runtime/options.js'

declare module '@nuxt/schema' {
  interface NuxtConfig {
    adaptiveDebounce?: AdaptiveDebounceNuxtOptions
  }

  interface NuxtOptions {
    adaptiveDebounce?: AdaptiveDebounceNuxtOptions
  }

  interface PublicRuntimeConfig {
    adaptiveDebounce?: AdaptiveDebounceNuxtOptions
  }
}

declare module 'nuxt/app' {
  interface NuxtApp {
    readonly $adaptiveDebounce: AdaptiveDebounceRuntime
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    readonly $adaptiveDebounce: AdaptiveDebounceRuntime
  }
}

const COMPOSABLES = [
  'useAdaptiveDebounceRuntime',
  'useAdaptiveDelay',
  'useAdaptiveDebouncedFn',
] as const

const NUMERIC_DELAY_KEYS = [
  'minimumDelayMs',
  'initialDelayMs',
  'maximumDelayMs',
  'smoothing',
  'intervalMultiplier',
  'quietPeriodMs',
  'idleResetMs',
] as const

/** Registers the module's one universal plugin and composable auto-imports. */
export function setupAdaptiveDebounceModule(
  options: AdaptiveDebounceNuxtOptions,
  nuxt: Nuxt,
): void {
  const runtimeOptions = normalizeModuleOptions(options)
  const resolver = createResolver(import.meta.url)

  addPlugin({ src: resolver.resolve('./runtime/plugin'), mode: 'all' })
  addImports(
    COMPOSABLES.map((name) => ({
      name,
      from: '@adaptive-debounce/vue',
    })),
  )
  nuxt.options.runtimeConfig.public.adaptiveDebounce = runtimeOptions
}

/** Nuxt module for one request-safe adaptive-debounce runtime per Nuxt application. */
export default defineNuxtModule<AdaptiveDebounceNuxtOptions>({
  meta: {
    name: '@adaptive-debounce/nuxt',
    configKey: 'adaptiveDebounce',
  },
  defaults: {
    observe: true,
    persistence: false,
  },
  setup: setupAdaptiveDebounceModule,
})

function normalizeModuleOptions(options: AdaptiveDebounceNuxtOptions): AdaptiveDebounceNuxtOptions {
  if (!isPlainObject(options)) {
    throw new TypeError('adaptiveDebounce options must be an object.')
  }
  rejectUnknownKeys(options, ['delay', 'observe', 'persistence'], 'adaptiveDebounce')
  if (options.observe !== undefined && typeof options.observe !== 'boolean') {
    throw new TypeError('adaptiveDebounce.observe must be a boolean.')
  }
  if (options.persistence !== undefined && typeof options.persistence !== 'boolean') {
    throw new TypeError('adaptiveDebounce.persistence must be a boolean.')
  }

  let delay: AdaptiveDebounceNuxtDelayOptions | undefined
  if (options.delay !== undefined) {
    if (!isPlainObject(options.delay)) {
      throw new TypeError('adaptiveDebounce.delay must be an object.')
    }
    rejectUnknownKeys(options.delay, NUMERIC_DELAY_KEYS, 'adaptiveDebounce.delay')
    createAdaptiveDelay(options.delay)
    delay = { ...options.delay }
  }

  return {
    ...(delay ? { delay } : {}),
    observe: options.observe ?? true,
    persistence: options.persistence ?? false,
  }
}

function rejectUnknownKeys(value: object, supported: readonly string[], scope: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string' && supported.includes(key)) {
      continue
    }
    throw new TypeError(`${scope} contains unsupported key "${String(key)}".`)
  }
  for (const key of supported) {
    if (!hasOwn(value, key) && key in value) {
      throw new TypeError(`${scope} must define "${key}" as an own property.`)
    }
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Reflect.getOwnPropertyDescriptor(value, key) !== undefined
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (!isObject(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
