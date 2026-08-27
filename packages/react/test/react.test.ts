import type { AdaptiveDebounced, AdaptiveDelayStateV1 } from 'adaptive-debounce'
import type { AdaptiveDelayPersistenceAdapter } from 'adaptive-debounce/persistence'
import { createElement, type ReactElement, type ReactNode, StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { act } from 'react-dom/test-utils'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  type AdaptiveDebouncedCallbackOptions,
  AdaptiveDebounceProvider,
  type AdaptiveDebounceRuntime,
  useAdaptiveDebouncedCallback,
  useAdaptiveDebounceRuntime,
  useAdaptiveDelay,
} from '../src/index'

const OBSERVED_EVENTS = new Set(['beforeinput', 'compositionend', 'keydown', 'keyup'])

interface MountedRoot {
  render(node: ReactNode): Promise<void>
  unmount(): Promise<void>
}

interface Deferred<Value> {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
}

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  document.body.replaceChildren()
})

describe('AdaptiveDebounceProvider', () => {
  it('hydrates the deterministic cold state without mismatch warnings', async () => {
    function Delay(): ReactElement {
      return createElement('span', null, useAdaptiveDelay())
    }

    const node = createElement(
      AdaptiveDebounceProvider,
      { observation: false },
      createElement(Delay),
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(node)
    document.body.append(container)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let root: ReturnType<typeof hydrateRoot> | undefined

    await act(async () => {
      root = hydrateRoot(container, node)
      await Promise.resolve()
    })

    expect(container.textContent).toBe('750')
    expect(error).not.toHaveBeenCalled()

    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
  })

  it('cleans up and restarts observation in React Strict Mode', async () => {
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const removeEventListener = vi.spyOn(document, 'removeEventListener')
    const mounted = createMountedRoot()

    await mounted.render(
      createElement(
        StrictMode,
        null,
        createElement(AdaptiveDebounceProvider, null, createElement('span')),
      ),
    )

    expect(observedCalls(addEventListener.mock.calls)).toHaveLength(8)
    expect(observedCalls(removeEventListener.mock.calls)).toHaveLength(4)

    await mounted.unmount()

    expect(observedCalls(removeEventListener.mock.calls)).toHaveLength(8)
  })

  it('loads before observing and ignores a stale Strict Mode load', async () => {
    const firstLoad = deferred<unknown>()
    const secondLoad = deferred<unknown>()
    const adapter = createAdapter()
    adapter.load
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise)
    const addEventListener = vi.spyOn(document, 'addEventListener')
    let runtime: AdaptiveDebounceRuntime | undefined

    function Capture(): null {
      runtime = useAdaptiveDebounceRuntime()
      return null
    }

    const mounted = createMountedRoot()
    await mounted.render(
      createElement(
        StrictMode,
        null,
        createElement(
          AdaptiveDebounceProvider,
          { persistence: { adapter } },
          createElement(Capture),
        ),
      ),
    )

    expect(adapter.load).toHaveBeenCalledTimes(2)
    expect(observedCalls(addEventListener.mock.calls)).toHaveLength(0)

    await resolveDeferred(secondLoad, state(200))
    expect(runtime?.delay.getDelay()).toBe(1_350)
    expect(observedCalls(addEventListener.mock.calls)).toHaveLength(4)

    await resolveDeferred(firstLoad, state(50))
    expect(runtime?.delay.getDelay()).toBe(1_350)
    expect(observedCalls(addEventListener.mock.calls)).toHaveLength(4)

    await mounted.unmount()
  })

  it('opts into autosave and exposes rejecting manual persistence methods', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    let runtime: AdaptiveDebounceRuntime | undefined

    function Capture(): null {
      runtime = useAdaptiveDebounceRuntime()
      return null
    }

    const mounted = createMountedRoot()
    await mounted.render(
      createElement(
        AdaptiveDebounceProvider,
        { observation: false, persistence: { adapter } },
        createElement(Capture),
      ),
    )

    expect(adapter.load).toHaveBeenCalledOnce()
    const activeRuntime = requireRuntime(runtime)
    activeRuntime.delay.importState(state(100))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(adapter.save).toHaveBeenCalledWith(state(100))

    const clearError = new Error('storage denied')
    adapter.clear.mockRejectedValueOnce(clearError)
    await expect(activeRuntime.clear()).rejects.toBe(clearError)

    await mounted.unmount()

    const disabled = createMountedRoot()
    await disabled.render(
      createElement(AdaptiveDebounceProvider, { observation: false }, createElement(Capture)),
    )
    await expect(requireRuntime(runtime).flush()).rejects.toThrow('persistence is not active')
    await disabled.unmount()
  })

  it('uses the built-in localStorage profile when persistence is true', async () => {
    vi.useFakeTimers()
    localStorage.setItem('adaptive-debounce:state', JSON.stringify(state(100)))
    let runtime: AdaptiveDebounceRuntime | undefined

    function Capture(): null {
      runtime = useAdaptiveDebounceRuntime()
      return null
    }

    const mounted = createMountedRoot()
    await mounted.render(
      createElement(
        AdaptiveDebounceProvider,
        { observation: false, persistence: true },
        createElement(Capture),
      ),
    )

    const activeRuntime = requireRuntime(runtime)
    expect(activeRuntime.delay.getDelay()).toBe(850)
    activeRuntime.delay.importState(state(200))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(JSON.parse(localStorage.getItem('adaptive-debounce:state') ?? 'null')).toEqual(
      state(200),
    )

    await mounted.unmount()
  })

  it('reports automatic load errors and still starts observation', async () => {
    const loadError = new Error('load failed')
    const adapter = createAdapter()
    adapter.load.mockRejectedValueOnce(loadError)
    const onError = vi.fn()
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const mounted = createMountedRoot()

    await mounted.render(
      createElement(
        AdaptiveDebounceProvider,
        { onError, persistence: { adapter } },
        createElement('span'),
      ),
    )

    expect(onError).toHaveBeenCalledWith(loadError)
    expect(observedCalls(addEventListener.mock.calls)).toHaveLength(4)
    await mounted.unmount()
  })

  it('publishes live delay snapshots', async () => {
    const snapshots: number[] = []
    let runtime: AdaptiveDebounceRuntime | undefined

    function Capture(): ReactElement {
      runtime = useAdaptiveDebounceRuntime()
      const delayMs = useAdaptiveDelay()
      snapshots.push(delayMs)
      return createElement('span', null, delayMs)
    }

    const mounted = createMountedRoot()
    await mounted.render(
      createElement(AdaptiveDebounceProvider, { observation: false }, createElement(Capture)),
    )
    expect(document.body.textContent).toBe('750')

    await act(async () => {
      requireRuntime(runtime).delay.importState(state(100))
    })

    expect(document.body.textContent).toBe('850')
    expect(snapshots[snapshots.length - 1]).toBe(850)
    await mounted.unmount()
  })
})

describe('useAdaptiveDebouncedCallback', () => {
  it('keeps its identity and deadline while switching to the latest callback', async () => {
    vi.useFakeTimers()
    const firstCallback = vi.fn(() => 'first')
    const secondCallback = vi.fn(() => 'second')
    let debounced: AdaptiveDebounced<unknown, [value: string], string> | undefined

    function Capture({ callback }: { readonly callback: (value: string) => string }): null {
      debounced = useAdaptiveDebouncedCallback(callback)
      return null
    }

    const mounted = createMountedRoot()
    await mounted.render(provider(createElement(Capture, { callback: firstCallback })))
    const original = requireDebounced(debounced)
    const result = original('value')

    await act(async () => {
      vi.advanceTimersByTime(50)
    })
    await mounted.render(provider(createElement(Capture, { callback: secondCallback })))
    expect(debounced).toBe(original)

    await act(async () => {
      vi.advanceTimersByTime(49)
    })
    expect(secondCallback).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await expect(result).resolves.toBe('second')
    expect(firstCallback).not.toHaveBeenCalled()
    expect(secondCallback).toHaveBeenCalledWith('value')
    await mounted.unmount()
  })

  it('cancels only when timing options change or the component unmounts', async () => {
    vi.useFakeTimers()
    let debounced: AdaptiveDebounced<unknown, [], string> | undefined

    function Capture({ options }: { readonly options?: AdaptiveDebouncedCallbackOptions }): null {
      debounced = useAdaptiveDebouncedCallback(() => 'saved', options)
      return null
    }

    const mounted = createMountedRoot()
    await mounted.render(provider(createElement(Capture, null)))
    const original = requireDebounced(debounced)
    const optionChangeError = original().catch((error: unknown) => error)

    await mounted.render(provider(createElement(Capture, { options: { maxWait: 200 } })))
    expect(debounced).not.toBe(original)
    await expect(optionChangeError).resolves.toMatchObject({ name: 'AbortError' })

    const unmountError = requireDebounced(debounced)().catch((error: unknown) => error)
    await mounted.unmount()
    await expect(unmountError).resolves.toMatchObject({ name: 'AbortError' })
  })

  it('keeps callback timers independent and does not record hook calls', async () => {
    vi.useFakeTimers()
    let first: AdaptiveDebounced<unknown, [], string> | undefined
    let second: AdaptiveDebounced<unknown, [], string> | undefined
    let runtime: AdaptiveDebounceRuntime | undefined

    function Capture(): null {
      runtime = useAdaptiveDebounceRuntime()
      first = useAdaptiveDebouncedCallback(() => 'first')
      second = useAdaptiveDebouncedCallback(() => 'second')
      return null
    }

    const mounted = createMountedRoot()
    await mounted.render(provider(createElement(Capture)))
    const record = vi.spyOn(requireRuntime(runtime).delay, 'record')
    const firstCall = requireDebounced(first)().catch((error: unknown) => error)
    const secondDebounced = requireDebounced(second)
    const secondCall = secondDebounced()

    requireDebounced(first).cancel()
    expect(secondDebounced.pending()).toBe(true)
    await expect(firstCall).resolves.toMatchObject({ name: 'AbortError' })

    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    await expect(secondCall).resolves.toBe('second')
    expect(record).not.toHaveBeenCalled()
    await mounted.unmount()
  })
})

function provider(child: ReactElement): ReactElement {
  return createElement(
    AdaptiveDebounceProvider,
    {
      delay: {
        minimumDelayMs: 100,
        initialDelayMs: 100,
        maximumDelayMs: 100,
        quietPeriodMs: 0,
      },
      observation: false,
    },
    child,
  )
}

function createMountedRoot(): MountedRoot {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  return {
    async render(node): Promise<void> {
      await act(async () => {
        root.render(node)
        await Promise.resolve()
      })
    },
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount()
        await Promise.resolve()
      })
      container.remove()
    },
  }
}

function observedCalls(calls: readonly unknown[][]): readonly unknown[][] {
  return calls.filter(
    ([eventName]) => typeof eventName === 'string' && OBSERVED_EVENTS.has(eventName),
  )
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function resolveDeferred<Value>(target: Deferred<Value>, value: Value): Promise<void> {
  await act(async () => {
    target.resolve(value)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function state(smoothedIntervalMs: number): AdaptiveDelayStateV1 {
  return { version: 1, smoothedIntervalMs }
}

function createAdapter() {
  return {
    load: vi.fn<AdaptiveDelayPersistenceAdapter['load']>(() => undefined),
    save: vi.fn<AdaptiveDelayPersistenceAdapter['save']>(),
    clear: vi.fn<AdaptiveDelayPersistenceAdapter['clear']>(),
  }
}

function requireRuntime(runtime: AdaptiveDebounceRuntime | undefined): AdaptiveDebounceRuntime {
  if (!runtime) {
    throw new Error('Test runtime was not captured.')
  }
  return runtime
}

function requireDebounced<Arguments extends unknown[], Result>(
  debounced: AdaptiveDebounced<unknown, Arguments, Result> | undefined,
): AdaptiveDebounced<unknown, Arguments, Result> {
  if (!debounced) {
    throw new Error('Test callback was not captured.')
  }
  return debounced
}
