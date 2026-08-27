import { createAdaptiveDelay } from 'adaptive-debounce'
import type { AdaptiveDelayPersistenceAdapter } from 'adaptive-debounce/persistence'
import { createRenderer, createSSRApp, effectScope, h, inject, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adaptiveDebounceKey,
  createAdaptiveDebouncePlugin,
  type AdaptiveDebounceRuntime,
  useAdaptiveDebouncedFn,
  useAdaptiveDebounceRuntime,
  useAdaptiveDelay,
} from '../src/index'

interface HostNode {
  parent: HostElement | null
  text: string
}

interface HostElement extends HostNode {
  readonly children: HostNode[]
}

class FakeObservationRoot {
  added = 0
  removed = 0

  addEventListener(): void {
    this.added += 1
  }

  removeEventListener(): void {
    this.removed += 1
  }
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

afterEach(() => {
  restoreGlobal('document', originalDocument)
  restoreGlobal('localStorage', originalLocalStorage)
  vi.useRealTimers()
})

describe('@adaptive-debounce/vue', () => {
  it('installs without warning when no runtime is present yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const app = createSSRApp({ render: () => null })

    app.use(createAdaptiveDebouncePlugin({ autoStart: false }))

    expect(warn).not.toHaveBeenCalled()
  })

  it('is SSR-safe and isolates multiple Vue applications', () => {
    Reflect.deleteProperty(globalThis, 'document')
    const first = createSSRApp({ render: () => null })
    const second = createSSRApp({ render: () => null })

    first.use(createAdaptiveDebouncePlugin())
    second.use(createAdaptiveDebouncePlugin())

    expect(getRuntime(first)).not.toBe(getRuntime(second))
    expect(getRuntime(first).delay.getDelay()).toBe(750)
  })

  it('keeps one runtime across scopes and ignores duplicate installation', () => {
    const app = createSSRApp({ render: () => null })
    app.use(createAdaptiveDebouncePlugin({ autoStart: false }))
    const installed = getRuntime(app)
    app.use(createAdaptiveDebouncePlugin({ autoStart: false }))

    const scopes = [effectScope(), effectScope()]
    const resolved = scopes.map((scope) =>
      app.runWithContext(() => scope.run(useAdaptiveDebounceRuntime)),
    )

    expect(getRuntime(app)).toBe(installed)
    expect(resolved).toEqual([installed, installed])
    for (const scope of scopes) {
      scope.stop()
    }
  })

  it('updates a readonly shallow ref and unsubscribes with its scope', () => {
    let now = 0
    const delay = createAdaptiveDelay({ clock: () => now })
    const app = createSSRApp({ render: () => null })
    app.use(createAdaptiveDebouncePlugin({ autoStart: false, delay }))
    const scope = effectScope()
    const delayRef = app.runWithContext(() => scope.run(useAdaptiveDelay))
    if (!delayRef) {
      throw new Error('Expected an active scope result.')
    }

    const initial = delayRef.value
    delay.record()
    now = 100
    delay.record()
    expect(delayRef.value).not.toBe(initial)

    const beforeStop = delayRef.value
    scope.stop()
    now = 250
    delay.record()
    expect(delayRef.value).toBe(beforeStop)
  })

  it('loads before observation and ignores a stopped async load', async () => {
    defineGlobal('document', {})
    const root = new FakeObservationRoot()
    const firstLoad = deferred<unknown>()
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: vi.fn(() => firstLoad.promise),
      save: vi.fn(),
      clear: vi.fn(),
    }
    const app = createSSRApp({ render: () => null })
    app.use(
      createAdaptiveDebouncePlugin({
        autoStart: false,
        observe: { root: root as unknown as Document },
        persistence: { adapter, autosave: false },
      }),
    )
    const runtime = getRuntime(app)

    const stoppedStart = runtime.start()
    expect(runtime.start()).toBe(stoppedStart)
    expect(root.added).toBe(0)
    runtime.stop()
    firstLoad.resolve({ version: 1, smoothedIntervalMs: 200 })
    await stoppedStart
    expect(runtime.delay.getDelay()).toBe(750)
    expect(root.added).toBe(0)

    const secondLoad = deferred<unknown>()
    vi.mocked(adapter.load).mockReturnValueOnce(secondLoad.promise)
    const restarted = runtime.start()
    expect(root.added).toBe(0)
    secondLoad.resolve({ version: 1, smoothedIntervalMs: 200 })
    const stop = await restarted
    expect(root.added).toBe(4)
    expect(runtime.delay.getDelay()).toBe(1_350)
    stop()
    stop()
    expect(root.removed).toBe(4)
  })

  it('creates a fresh activation after a same-tick stop and restart', async () => {
    defineGlobal('document', {})
    const root = new FakeObservationRoot()
    const app = createSSRApp({ render: () => null })
    app.use(
      createAdaptiveDebouncePlugin({
        autoStart: false,
        observe: { root: root as unknown as Document },
      }),
    )
    const runtime = getRuntime(app)

    const firstStart = runtime.start()
    runtime.stop()
    const secondStart = runtime.start()

    expect(secondStart).not.toBe(firstStart)
    const secondStop = await secondStart
    expect(root.added).toBe(8)
    expect(root.removed).toBe(4)

    secondStop()
    expect(root.removed).toBe(8)
  })

  it('uses localStorage only after persistence is opted in and started', async () => {
    const getItem = vi.fn(() => null)
    defineGlobal('localStorage', {
      getItem,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
    const app = createSSRApp({ render: () => null })
    app.use(
      createAdaptiveDebouncePlugin({
        autoStart: false,
        observe: false,
        persistence: true,
      }),
    )
    expect(getItem).not.toHaveBeenCalled()

    await getRuntime(app).start()
    expect(getItem).toHaveBeenCalledWith('adaptive-debounce:state')
  })

  it('reports an automatic load failure and still starts observation', async () => {
    defineGlobal('document', {})
    const root = new FakeObservationRoot()
    const onError = vi.fn()
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: vi.fn(() => Promise.reject(new Error('storage unavailable'))),
      save: vi.fn(),
      clear: vi.fn(),
    }
    const app = createSSRApp({ render: () => null })
    app.use(
      createAdaptiveDebouncePlugin({
        autoStart: false,
        observe: { root: root as unknown as Document },
        persistence: { adapter, autosave: false },
        onError,
      }),
    )

    await getRuntime(app).start()
    expect(onError).toHaveBeenCalledOnce()
    expect(root.added).toBe(4)
  })

  it('prevents a late initial load from restoring state after clear', async () => {
    const pendingLoad = deferred<unknown>()
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: vi.fn(() => pendingLoad.promise),
      save: vi.fn(),
      clear: vi.fn(),
    }
    const app = createSSRApp({ render: () => null })
    app.use(
      createAdaptiveDebouncePlugin({
        autoStart: false,
        observe: false,
        persistence: { adapter, autosave: false },
      }),
    )
    const runtime = getRuntime(app)
    const started = runtime.start()
    if (!runtime.persistence) {
      throw new Error('Expected persistence controls.')
    }

    await runtime.persistence.clear()
    pendingLoad.resolve({ version: 1, smoothedIntervalMs: 200 })
    await started

    expect(runtime.delay.getDelay()).toBe(750)
    expect(adapter.clear).toHaveBeenCalledOnce()
  })

  it('rejects inherited plugin configuration', () => {
    const inherited = Object.create({ persistence: true }) as {
      persistence?: boolean
    }
    const app = createSSRApp({ render: () => null })
    expect(() => app.use(createAdaptiveDebouncePlugin(inherited))).toThrow(
      'Vue plugin options must be an object',
    )
  })

  it('rejects hidden, symbolic, and Object.prototype-carried configuration', () => {
    const hidden = Object.defineProperty({}, 'unsupported', { value: true })
    const symbolic = { [Symbol('unsupported')]: true }

    expect(() => installPlugin(hidden)).toThrow('unsupported key "unsupported"')
    expect(() => installPlugin(symbolic)).toThrow('unsupported key "Symbol(unsupported)"')

    withObjectPrototypeProperty('persistence', true, () => {
      expect(() => installPlugin({})).toThrow('persistence" as an own property')
    })
    withObjectPrototypeProperty('autosave', false, () => {
      expect(() => installPlugin({ persistence: {} })).toThrow('autosave" as an own property')
    })
    withObjectPrototypeProperty('initialDelayMs', 900, () => {
      expect(() => installPlugin({ delay: {} })).toThrow('initialDelayMs" as an own property')
    })
  })

  it('keeps callback windows independent and never trains from wrapper calls', async () => {
    vi.useFakeTimers()
    const baseDelay = createAdaptiveDelay({
      minimumDelayMs: 10,
      initialDelayMs: 10,
      maximumDelayMs: 10,
    })
    const record = vi.fn(baseDelay.record)
    const delay = { ...baseDelay, record }
    const app = createSSRApp({ render: () => null })
    app.use(createAdaptiveDebouncePlugin({ autoStart: false, delay }))
    const scope = effectScope()
    let first: ReturnType<typeof useAdaptiveDebouncedFn<unknown, [number], number>> | undefined
    let second: ReturnType<typeof useAdaptiveDebouncedFn<unknown, [number], number>> | undefined
    app.runWithContext(() => {
      scope.run(() => {
        first = useAdaptiveDebouncedFn((value: number) => value + 1)
        second = useAdaptiveDebouncedFn(async (value: number) => value + 2)
      })
    })
    if (!first || !second) {
      throw new Error('Expected debounced callbacks.')
    }

    const cancelled = first(1)
    const completed = second(2)
    first.cancel('cancel first only')
    await expect(cancelled).rejects.toBe('cancel first only')
    expect(second.pending()).toBe(true)

    await vi.advanceTimersByTimeAsync(10)
    await expect(completed).resolves.toBe(4)
    expect(record).not.toHaveBeenCalled()

    const cancelledByScope = second(3)
    const scopedRejection = expect(cancelledByScope).rejects.toMatchObject({ name: 'AbortError' })
    scope.stop()
    await scopedRejection
  })

  it('cancels scoped work and disposes observation when the app unmounts', async () => {
    defineGlobal('document', {})
    const root = new FakeObservationRoot()
    const app = createHostApp()
    app.use(
      createAdaptiveDebouncePlugin({
        autoStart: false,
        observe: { root: root as unknown as Document },
      }),
    )
    app.mount(createHostElement())
    const runtime = getRuntime(app)
    await runtime.start()
    expect(root.added).toBe(4)

    app.unmount()
    expect(root.removed).toBe(4)
    await expect(runtime.start()).rejects.toThrow('disposed')
  })
})

function getRuntime(app: App): AdaptiveDebounceRuntime {
  const runtime = app.runWithContext(() => inject(adaptiveDebounceKey))
  if (!runtime) {
    throw new Error('Expected an installed runtime.')
  }
  return runtime
}

function installPlugin(options: unknown): void {
  const app = createSSRApp({ render: () => null })
  app.use(
    createAdaptiveDebouncePlugin(options as Parameters<typeof createAdaptiveDebouncePlugin>[0]),
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

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function defineGlobal(name: 'document' | 'localStorage', value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, value })
}

function restoreGlobal(
  name: 'document' | 'localStorage',
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor)
  } else {
    Reflect.deleteProperty(globalThis, name)
  }
}

function createHostElement(): HostElement {
  return { children: [], parent: null, text: '' }
}

function createHostApp(): App {
  const renderer = createRenderer<HostNode, HostElement>({
    patchProp: () => undefined,
    insert(node, parent, anchor): void {
      node.parent = parent
      const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1
      if (anchorIndex === -1) {
        parent.children.push(node)
      } else {
        parent.children.splice(anchorIndex, 0, node)
      }
    },
    remove(node): void {
      const parent = node.parent
      if (!parent) {
        return
      }
      const index = parent.children.indexOf(node)
      if (index !== -1) {
        parent.children.splice(index, 1)
      }
      node.parent = null
    },
    createElement: createHostElement,
    createText: (text) => ({ parent: null, text }),
    createComment: (text) => ({ parent: null, text }),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
    },
    parentNode: (node) => node.parent,
    nextSibling(node) {
      const parent = node.parent
      if (!parent) {
        return null
      }
      const index = parent.children.indexOf(node)
      return parent.children[index + 1] ?? null
    },
  })
  return renderer.createApp({ render: () => h('div') })
}
