import type { NuxtApp } from 'nuxt/app'
import { createSSRApp, inject } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adaptiveDebounceKey } from '@adaptive-debounce/vue'

const nuxtRuntime = vi.hoisted(() => ({
  config: { public: {} } as { public: Record<string, unknown> },
}))

vi.mock('nuxt/app', () => ({
  defineNuxtPlugin: <Plugin>(plugin: Plugin) => plugin,
  useRuntimeConfig: () => nuxtRuntime.config,
}))

import runtimePlugin, { installNuxtAdaptiveDebounce } from '../src/runtime/plugin'

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

afterEach(() => {
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument)
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
})

describe('@adaptive-debounce/nuxt runtime', () => {
  it('installs without warning when no runtime is present yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const nuxt = createNuxtApp()

    installNuxtAdaptiveDebounce(nuxt.app, {
      observe: false,
      persistence: false,
    })

    expect(warn).not.toHaveBeenCalled()
  })

  it('creates isolated SSR runtimes and is idempotent per Nuxt app', () => {
    const first = createNuxtApp()
    const second = createNuxtApp()

    const firstRuntime = installNuxtAdaptiveDebounce(first.app, {
      observe: false,
      persistence: false,
    })
    const duplicate = installNuxtAdaptiveDebounce(first.app, {
      observe: false,
      persistence: false,
    })
    const secondRuntime = installNuxtAdaptiveDebounce(second.app, {
      observe: false,
      persistence: false,
    })

    expect(duplicate).toBe(firstRuntime)
    expect(secondRuntime).not.toBe(firstRuntime)
    expect(first.hook).toHaveBeenCalledTimes(1)
    expect(second.hook).toHaveBeenCalledTimes(1)
    expect(getInjectedRuntime(first.app)).toBe(firstRuntime)
  })

  it('starts only from the client mounted hook', async () => {
    const nuxt = createNuxtApp()
    const runtime = installNuxtAdaptiveDebounce(nuxt.app, {
      observe: false,
      persistence: false,
    })
    const start = vi.spyOn(runtime, 'start')
    const mounted = nuxt.mounted()

    Reflect.deleteProperty(globalThis, 'document')
    mounted()
    expect(start).not.toHaveBeenCalled()

    Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
    mounted()
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
  })

  it('provides the request-local runtime from the universal plugin', () => {
    nuxtRuntime.config.public = {
      adaptiveDebounce: { observe: false, persistence: false },
    }
    const nuxt = createNuxtApp()
    const result = runtimePlugin(nuxt.app)
    if (!result || result instanceof Promise || !('provide' in result) || !result.provide) {
      throw new Error('Expected synchronous Nuxt plugin injection.')
    }

    expect(result.provide.adaptiveDebounce).toBe(getInjectedRuntime(nuxt.app))
  })
})

function createNuxtApp() {
  const mountedCallbacks: Array<() => void> = []
  const hook = vi.fn((name: string, callback: () => void) => {
    if (name === 'app:mounted') {
      mountedCallbacks.push(callback)
    }
    return () => undefined
  })
  const vueApp = createSSRApp({ render: () => null })
  const app = { vueApp, hook } as unknown as NuxtApp
  return {
    app,
    hook,
    mounted(): () => void {
      const callback = mountedCallbacks[0]
      if (!callback) {
        throw new Error('Expected an app:mounted hook.')
      }
      return callback
    },
  }
}

function getInjectedRuntime(nuxtApp: NuxtApp) {
  return nuxtApp.vueApp.runWithContext(() => inject(adaptiveDebounceKey))
}
