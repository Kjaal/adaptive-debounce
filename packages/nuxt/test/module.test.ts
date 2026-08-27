import type { Nuxt } from '@nuxt/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const kit = vi.hoisted(() => ({
  addImports: vi.fn(),
  addPlugin: vi.fn(),
  createResolver: vi.fn(() => ({ resolve: (path: string) => path })),
}))

vi.mock('@nuxt/kit', () => ({
  ...kit,
  defineNuxtModule: <Options>(definition: Options) => definition,
}))

import { setupAdaptiveDebounceModule } from '../src/module'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('@adaptive-debounce/nuxt module', () => {
  it('registers exactly one universal plugin and one composable batch', () => {
    const nuxt = createNuxt()
    setupAdaptiveDebounceModule(
      {
        delay: { initialDelayMs: 900 },
        observe: true,
        persistence: true,
      },
      nuxt,
    )

    expect(kit.addPlugin).toHaveBeenCalledOnce()
    expect(kit.addPlugin).toHaveBeenCalledWith({ src: './runtime/plugin', mode: 'all' })
    expect(kit.addImports).toHaveBeenCalledOnce()
    expect(kit.addImports).toHaveBeenCalledWith([
      { name: 'useAdaptiveDebounceRuntime', from: '@adaptive-debounce/vue' },
      { name: 'useAdaptiveDelay', from: '@adaptive-debounce/vue' },
      { name: 'useAdaptiveDebouncedFn', from: '@adaptive-debounce/vue' },
    ])
    expect(nuxt.options.runtimeConfig.public.adaptiveDebounce).toEqual({
      delay: { initialDelayMs: 900 },
      observe: true,
      persistence: true,
    })
  })

  it('rejects functions and unsupported configuration before serialization', () => {
    const nuxt = createNuxt()
    expect(() =>
      setupAdaptiveDebounceModule(
        {
          delay: { clock: () => 1 },
        } as unknown as Parameters<typeof setupAdaptiveDebounceModule>[0],
        nuxt,
      ),
    ).toThrow('unsupported key "clock"')
    expect(() =>
      setupAdaptiveDebounceModule(
        { observe: 'yes' } as unknown as Parameters<typeof setupAdaptiveDebounceModule>[0],
        nuxt,
      ),
    ).toThrow('observe must be a boolean')

    const inherited = Object.create({ persistence: true })
    expect(() =>
      setupAdaptiveDebounceModule(
        inherited as Parameters<typeof setupAdaptiveDebounceModule>[0],
        nuxt,
      ),
    ).toThrow('adaptiveDebounce options must be an object')
  })

  it('rejects hidden, symbolic, and Object.prototype-carried configuration', () => {
    const hidden = Object.defineProperty({}, 'unsupported', { value: true })
    const symbolic = { [Symbol('unsupported')]: true }

    expect(() => setup(hidden)).toThrow('unsupported key "unsupported"')
    expect(() => setup(symbolic)).toThrow('unsupported key "Symbol(unsupported)"')

    withObjectPrototypeProperty('observe', false, () => {
      expect(() => setup({})).toThrow('observe" as an own property')
    })
    withObjectPrototypeProperty('persistence', true, () => {
      expect(() => setup({})).toThrow('persistence" as an own property')
    })
    withObjectPrototypeProperty('initialDelayMs', 900, () => {
      expect(() => setup({ delay: {} })).toThrow('initialDelayMs" as an own property')
    })
  })
})

function setup(options: unknown): void {
  setupAdaptiveDebounceModule(
    options as Parameters<typeof setupAdaptiveDebounceModule>[0],
    createNuxt(),
  )
}

function withObjectPrototypeProperty(key: string, value: unknown, assertion: () => void): void {
  const original = Reflect.getOwnPropertyDescriptor(Object.prototype, key)
  Object.defineProperty(Object.prototype, key, { configurable: true, value })
  try {
    assertion()
  } finally {
    if (original) {
      Object.defineProperty(Object.prototype, key, original)
    } else {
      Reflect.deleteProperty(Object.prototype, key)
    }
  }
}

function createNuxt(): Nuxt {
  return {
    options: {
      runtimeConfig: {
        public: {},
      },
    },
  } as unknown as Nuxt
}
