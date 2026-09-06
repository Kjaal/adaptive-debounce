import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdaptiveDelay } from '../src/adaptive-delay'
import {
  type AdaptiveDelayPersistenceAdapter,
  type AdaptiveDelayPersistenceOptions,
  createAdaptiveDelayPersistence,
} from '../src/persistence'

const LOCAL_STORAGE_KEY = 'adaptive-debounce:state'
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function createMemoryStorage(initial: Readonly<Record<string, string>> = {}): Storage {
  const values = new Map(Object.entries(initial))

  return {
    get length() {
      return values.size
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  }
}

function deferred<Value = void>(): {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value | PromiseLike<Value>) => void
  readonly reject: (error: unknown) => void
} {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

describe('createAdaptiveDelayPersistence', () => {
  it('shares exact version-one JSON through the fixed same-origin localStorage key', async () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)

    const firstDelay = createAdaptiveDelay()
    firstDelay.importState({ version: 1, smoothedIntervalMs: 120 })
    const firstPersistence = createAdaptiveDelayPersistence(firstDelay)

    await firstPersistence.save()
    expect(storage.setItem).toHaveBeenCalledWith(
      LOCAL_STORAGE_KEY,
      '{"version":1,"smoothedIntervalMs":120}',
    )

    const secondDelay = createAdaptiveDelay()
    const secondPersistence = createAdaptiveDelayPersistence(secondDelay, {})
    await expect(secondPersistence.load()).resolves.toBe('imported')
    expect(secondDelay.exportState().smoothedIntervalMs).toBe(120)

    secondDelay.importState({ version: 1, smoothedIntervalMs: 240 })
    await secondPersistence.save()
    firstDelay.reset()
    await expect(firstPersistence.load()).resolves.toBe('imported')
    expect(firstDelay.exportState().smoothedIntervalMs).toBe(240)

    await secondPersistence.clear()
    expect(storage.removeItem).toHaveBeenCalledWith(LOCAL_STORAGE_KEY)
    expect(storage.getItem(LOCAL_STORAGE_KEY)).toBeNull()
    expect(secondDelay.exportState().smoothedIntervalMs).toBeNull()
  })

  it('treats missing and corrupt localStorage JSON as invalid without deleting it', async () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const delay = createAdaptiveDelay()
    delay.importState({ version: 1, smoothedIntervalMs: 160 })
    const persistence = createAdaptiveDelayPersistence(delay)

    await expect(persistence.load()).resolves.toBe('invalid')
    expect(delay.exportState().smoothedIntervalMs).toBe(160)

    storage.setItem(LOCAL_STORAGE_KEY, '{"version":1')
    await expect(persistence.load()).resolves.toBe('invalid')
    expect(delay.exportState().smoothedIntervalMs).toBe(160)
    expect(storage.getItem(LOCAL_STORAGE_KEY)).toBe('{"version":1')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('constructs without storage and rejects default operations with client guidance', async () => {
    vi.stubGlobal('localStorage', undefined)
    const delay = createAdaptiveDelay()
    delay.importState({ version: 1, smoothedIntervalMs: 120 })
    const persistence = createAdaptiveDelayPersistence(delay)
    const expectedError = /client lifecycle or pass a custom adapter/

    await expect(persistence.load()).rejects.toThrow(expectedError)
    await expect(persistence.save()).rejects.toThrow(expectedError)
    await expect(persistence.clear()).rejects.toThrow(expectedError)
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
  })

  it('does not read a throwing localStorage getter until an operation runs', async () => {
    const storageError = new Error('storage getter failed')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw storageError
      },
    })

    const persistence = createAdaptiveDelayPersistence(createAdaptiveDelay())
    await expect(persistence.load()).rejects.toBe(storageError)
  })

  it('propagates localStorage read, write, and remove failures', async () => {
    const readError = new Error('read failed')
    const readStorage = createMemoryStorage()
    vi.mocked(readStorage.getItem).mockImplementation(() => {
      throw readError
    })
    vi.stubGlobal('localStorage', readStorage)

    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay)
    await expect(persistence.load()).rejects.toBe(readError)

    const writeError = new Error('write failed')
    const writeStorage = createMemoryStorage()
    vi.mocked(writeStorage.setItem).mockImplementation(() => {
      throw writeError
    })
    vi.stubGlobal('localStorage', writeStorage)
    delay.importState({ version: 1, smoothedIntervalMs: 120 })
    await expect(persistence.save()).rejects.toBe(writeError)

    const removeError = new Error('remove failed')
    const removeStorage = createMemoryStorage()
    vi.mocked(removeStorage.removeItem).mockImplementation(() => {
      throw removeError
    })
    vi.stubGlobal('localStorage', removeStorage)
    await expect(persistence.clear()).rejects.toBe(removeError)
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
  })

  it('reports built-in localStorage autosave failures through onError', async () => {
    vi.useFakeTimers()
    const writeError = new Error('quota exceeded')
    const storage = createMemoryStorage()
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw writeError
    })
    vi.stubGlobal('localStorage', storage)
    const onError = vi.fn()
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, { autosave: { onError } })

    delay.importState({ version: 1, smoothedIntervalMs: 120 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onError).toHaveBeenCalledWith(writeError)

    persistence.dispose()
  })

  it('supports synchronous and asynchronous adapters', async () => {
    let syncState: unknown
    const syncAdapter: AdaptiveDelayPersistenceAdapter = {
      load: () => syncState,
      save: (state) => {
        syncState = state
      },
      clear: () => {
        syncState = undefined
      },
    }
    const syncDelay = createAdaptiveDelay()
    const syncPersistence = createAdaptiveDelayPersistence(syncDelay, syncAdapter)

    syncDelay.importState({ version: 1, smoothedIntervalMs: 120 })
    await syncPersistence.save()
    syncDelay.reset()
    await expect(syncPersistence.load()).resolves.toBe('imported')
    expect(syncDelay.exportState().smoothedIntervalMs).toBe(120)

    let asyncState: unknown = { version: 1, smoothedIntervalMs: 180 }
    const asyncAdapter: AdaptiveDelayPersistenceAdapter = {
      load: async () => asyncState,
      save: async (state) => {
        asyncState = state
      },
      clear: async () => {
        asyncState = undefined
      },
    }
    const asyncDelay = createAdaptiveDelay()
    const asyncPersistence = createAdaptiveDelayPersistence(asyncDelay, asyncAdapter)

    await expect(asyncPersistence.load()).resolves.toBe('imported')
    expect(asyncDelay.exportState().smoothedIntervalMs).toBe(180)
    await asyncPersistence.clear()
    expect(asyncDelay.exportState().smoothedIntervalMs).toBeNull()
    expect(asyncState).toBeUndefined()
  })

  it('passes untrusted reads through atomic core validation without autosaving loads', async () => {
    let stored: unknown = { version: 1, smoothedIntervalMs: 'private text' }
    const save = vi.fn()
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => stored,
      save,
      clear: () => undefined,
    }
    const delay = createAdaptiveDelay()
    delay.importState({ version: 1, smoothedIntervalMs: 160 })
    const persistence = createAdaptiveDelayPersistence(delay, adapter, {
      autosave: { onError: vi.fn() },
    })

    await expect(persistence.load()).resolves.toBe('invalid')
    expect(delay.exportState().smoothedIntervalMs).toBe(160)

    stored = { version: 2, smoothedIntervalMs: 100 }
    await expect(persistence.load()).resolves.toBe('unsupported-version')
    expect(delay.exportState().smoothedIntervalMs).toBe(160)

    stored = { version: 1, smoothedIntervalMs: 240 }
    await expect(persistence.load()).resolves.toBe('imported')
    expect(delay.exportState().smoothedIntervalMs).toBe(240)
    expect(save).not.toHaveBeenCalled()

    persistence.dispose()
  })

  it('serializes writes and coalesces many pending saves into one latest-state promise', async () => {
    const gates = [deferred(), deferred()]
    const states: unknown[] = []
    let activeWrites = 0
    let maximumActiveWrites = 0
    const save = vi.fn(async (state) => {
      const gate = gates[states.length]
      states.push(state)
      activeWrites += 1
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
      await gate?.promise
      activeWrites -= 1
    })
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => undefined,
      save,
      clear: () => undefined,
    }
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, adapter)

    delay.importState({ version: 1, smoothedIntervalMs: 100 })
    const first = persistence.save()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    delay.importState({ version: 1, smoothedIntervalMs: 200 })
    const second = persistence.save()
    let queuedSavesSharePromise = true
    for (let index = 0; index < 50_000; index += 1) {
      if (persistence.save() !== second) {
        queuedSavesSharePromise = false
      }
    }
    delay.importState({ version: 1, smoothedIntervalMs: 300 })
    const third = persistence.save()
    expect(queuedSavesSharePromise).toBe(true)
    expect(third).toBe(second)
    expect(save).toHaveBeenCalledTimes(1)

    gates[0]?.resolve()
    await first
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(states[1]).toEqual({ version: 1, smoothedIntervalMs: 300 })

    gates[1]?.resolve()
    await Promise.all([second, third])
    expect(maximumActiveWrites).toBe(1)
  })

  it('shares one stalled load promise and starts a fresh load after it settles', async () => {
    const read = deferred<unknown>()
    const load = vi.fn(() => read.promise)
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load,
      save: () => undefined,
      clear: () => undefined,
    }
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, adapter)

    const first = persistence.load()
    let duplicatesSharePromise = true
    for (let index = 0; index < 50_000; index += 1) {
      if (persistence.load() !== first) {
        duplicatesSharePromise = false
      }
    }

    expect(duplicatesSharePromise).toBe(true)
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())

    read.resolve({ version: 1, smoothedIntervalMs: 180 })
    await expect(first).resolves.toBe('imported')
    expect(delay.exportState().smoothedIntervalMs).toBe(180)

    const next = persistence.load()
    expect(next).not.toBe(first)
    await expect(next).resolves.toBe('imported')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one stalled clear promise and starts a fresh clear after it settles', async () => {
    const clearing = deferred()
    const clear = vi.fn(() => clearing.promise)
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => undefined,
      save: () => undefined,
      clear,
    }
    const delay = createAdaptiveDelay()
    delay.importState({ version: 1, smoothedIntervalMs: 180 })
    const persistence = createAdaptiveDelayPersistence(delay, adapter)

    const first = persistence.clear()
    let duplicatesSharePromise = true
    for (let index = 0; index < 50_000; index += 1) {
      if (persistence.clear() !== first) {
        duplicatesSharePromise = false
      }
    }

    expect(duplicatesSharePromise).toBe(true)
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce())

    clearing.resolve()
    await expect(first).resolves.toBeUndefined()

    const next = persistence.clear()
    expect(next).not.toBe(first)
    await expect(next).resolves.toBeUndefined()
    expect(clear).toHaveBeenCalledTimes(2)
  })

  it('uses one trailing autosave, flushes it immediately, and reports background errors', async () => {
    vi.useFakeTimers()
    const autosaveError = new Error('write failed')
    const onError = vi.fn()
    const save = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(autosaveError)
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => undefined,
      save,
      clear: () => undefined,
    }
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, adapter, {
      autosave: { onError },
    })

    delay.importState({ version: 1, smoothedIntervalMs: 100 })
    await vi.advanceTimersByTimeAsync(500)
    delay.importState({ version: 1, smoothedIntervalMs: 200 })
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()

    await persistence.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenLastCalledWith({ version: 1, smoothedIntervalMs: 200 })
    expect(vi.getTimerCount()).toBe(0)

    delay.importState({ version: 1, smoothedIntervalMs: 300 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(autosaveError)

    persistence.dispose()
  })

  it('reports each coalesced autosave failure once while a custom adapter stalls', async () => {
    vi.useFakeTimers()
    const activeWrite = deferred()
    const queuedWrite = deferred()
    const activeError = new Error('active write failed')
    const queuedError = new Error('queued write failed')
    const onError = vi.fn(() => {
      throw new Error('error callback failed')
    })
    const save = vi
      .fn()
      .mockReturnValueOnce(activeWrite.promise)
      .mockReturnValueOnce(queuedWrite.promise)
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(
      delay,
      { load: () => undefined, save, clear: () => undefined },
      { autosave: { onError } },
    )

    for (let index = 0; index < 500; index += 1) {
      delay.importState({ version: 1, smoothedIntervalMs: 100 + index })
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(save).toHaveBeenCalledOnce()
    const manualSave = expect(persistence.save()).rejects.toBe(queuedError)
    const flushed = expect(persistence.flush()).rejects.toBe(activeError)
    persistence.dispose()
    expect(vi.getTimerCount()).toBe(0)

    activeWrite.reject(activeError)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ version: 1, smoothedIntervalMs: 599 })
    queuedWrite.reject(queuedError)
    await Promise.all([manualSave, flushed])
    await vi.advanceTimersByTimeAsync(0)
    expect(onError.mock.calls).toEqual([[activeError], [queuedError]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears after an older active write and drops queued stale writes', async () => {
    const activeWrite = deferred()
    let stored: unknown
    const save = vi.fn(async (state) => {
      await activeWrite.promise
      stored = state
    })
    const clearAdapter = vi.fn(() => {
      stored = undefined
    })
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => stored,
      save,
      clear: clearAdapter,
    }
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, adapter)

    delay.importState({ version: 1, smoothedIntervalMs: 100 })
    const activeSave = persistence.save()
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())

    delay.importState({ version: 1, smoothedIntervalMs: 200 })
    const queuedSave = persistence.save()
    const clearing = persistence.clear()

    expect(delay.exportState().smoothedIntervalMs).toBeNull()
    expect(clearAdapter).not.toHaveBeenCalled()

    activeWrite.resolve()
    await Promise.all([activeSave, queuedSave, clearing])
    expect(save).toHaveBeenCalledOnce()
    expect(clearAdapter).toHaveBeenCalledOnce()
    expect(stored).toBeUndefined()
  })

  it('coalesces clear during load, resets immediately, and ignores the stale load', async () => {
    const read = deferred<unknown>()
    const cleared = deferred()
    const load = vi.fn(() => read.promise)
    const clear = vi.fn(() => cleared.promise)
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load,
      save: () => undefined,
      clear,
    }
    const delay = createAdaptiveDelay()
    delay.importState({ version: 1, smoothedIntervalMs: 120 })
    const persistence = createAdaptiveDelayPersistence(delay, adapter)

    const loading = persistence.load()
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())

    const clearing = persistence.clear()
    let duplicatesSharePromise = true
    for (let index = 0; index < 50_000; index += 1) {
      if (persistence.clear() !== clearing) {
        duplicatesSharePromise = false
      }
    }

    expect(duplicatesSharePromise).toBe(true)
    expect(clear).not.toHaveBeenCalled()
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
    await expect(persistence.load()).rejects.toThrow('clear operation already pending')

    read.resolve({ version: 1, smoothedIntervalMs: 200 })
    await expect(loading).resolves.toBe('invalid')
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce())

    cleared.resolve()
    await expect(clearing).resolves.toBeUndefined()
    expect(clear).toHaveBeenCalledOnce()
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
  })

  it('rejects load while clear is pending and recovers after the clear rejects', async () => {
    const clearError = new Error('clear failed')
    const clearing = deferred()
    const load = vi.fn(() => ({ version: 1, smoothedIntervalMs: 200 }))
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load,
      save: () => undefined,
      clear: () => clearing.promise,
    }
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, adapter)

    const activeClear = persistence.clear()
    await expect(persistence.load()).rejects.toThrow('clear operation already pending')
    expect(load).not.toHaveBeenCalled()

    clearing.reject(clearError)
    await expect(activeClear).rejects.toBe(clearError)

    await expect(persistence.load()).resolves.toBe('imported')
    expect(load).toHaveBeenCalledOnce()
    expect(delay.exportState().smoothedIntervalMs).toBe(200)
  })

  it('propagates manual adapter failures and continues the serialized queue', async () => {
    const loadError = new Error('load failed')
    const saveError = new Error('save failed')
    const clearError = new Error('clear failed')
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: vi.fn().mockRejectedValue(loadError),
      save: vi.fn().mockRejectedValueOnce(saveError).mockResolvedValueOnce(undefined),
      clear: vi.fn().mockRejectedValue(clearError),
    }
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, adapter)

    await expect(persistence.load()).rejects.toBe(loadError)
    await expect(persistence.save()).rejects.toBe(saveError)
    await expect(persistence.save()).resolves.toBeUndefined()
    await expect(persistence.clear()).rejects.toBe(clearError)
  })

  it('disposes autosave timers and subscriptions without saving', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => undefined,
      save,
      clear: () => undefined,
    }
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, adapter, {
      autosave: { onError: vi.fn() },
    })

    delay.importState({ version: 1, smoothedIntervalMs: 100 })
    expect(vi.getTimerCount()).toBe(1)
    persistence.dispose()
    persistence.dispose()
    expect(vi.getTimerCount()).toBe(0)

    delay.importState({ version: 1, smoothedIntervalMs: 200 })
    await vi.advanceTimersByTimeAsync(2_000)
    await persistence.flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects malformed adapters and autosave options', () => {
    const delay = createAdaptiveDelay()
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => undefined,
      save: () => undefined,
      clear: () => undefined,
    }

    expect(() => createAdaptiveDelayPersistence(delay, null as never)).toThrow('options')
    expect(() => createAdaptiveDelayPersistence(delay, { load: () => undefined } as never)).toThrow(
      'adapter',
    )
    expect(() => createAdaptiveDelayPersistence(delay, adapter, { autosave: {} as never })).toThrow(
      'onError',
    )
  })

  it('validates every own option key without consuming inherited configuration', async () => {
    vi.useFakeTimers()
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const delay = createAdaptiveDelay()
    const save = vi.fn()
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => undefined,
      save,
      clear: () => undefined,
    }
    const expectedGuidance = /pass a custom adapter for scoped keys or storage backends/

    expect(() => createAdaptiveDelayPersistence(delay, { key: 'custom' } as never)).toThrow(
      expectedGuidance,
    )
    expect(() =>
      createAdaptiveDelayPersistence(delay, adapter, { backend: 'memory' } as never),
    ).toThrow(expectedGuidance)
    expect(() =>
      createAdaptiveDelayPersistence(delay, {
        autosave: { onError: vi.fn(), waitMs: 250 },
      } as never),
    ).toThrow(expectedGuidance)

    const unsupportedKey = Symbol('custom')
    expect(() =>
      createAdaptiveDelayPersistence(delay, { [unsupportedKey]: true } as never),
    ).toThrow('Symbol(custom)')

    const hiddenOptions = Object.defineProperty({}, 'key', { value: 'custom' })
    expect(() => createAdaptiveDelayPersistence(delay, hiddenOptions as never)).toThrow(
      expectedGuidance,
    )

    const hiddenAutosave = Object.defineProperty({ onError: vi.fn() }, 'waitMs', { value: 250 })
    expect(() =>
      createAdaptiveDelayPersistence(delay, adapter, { autosave: hiddenAutosave } as never),
    ).toThrow(expectedGuidance)

    const inheritedKeyOptions = Object.create({ key: 'custom' }) as AdaptiveDelayPersistenceOptions
    const inheritedKeyPersistence = createAdaptiveDelayPersistence(delay, inheritedKeyOptions)
    delay.importState({ version: 1, smoothedIntervalMs: 180 })
    await inheritedKeyPersistence.save()
    expect(storage.setItem).toHaveBeenCalledWith(
      LOCAL_STORAGE_KEY,
      '{"version":1,"smoothedIntervalMs":180}',
    )
    inheritedKeyPersistence.dispose()

    const inheritedAutosaveOptions = Object.create({
      autosave: { onError: vi.fn() },
    }) as AdaptiveDelayPersistenceOptions
    const inheritedPersistence = createAdaptiveDelayPersistence(
      delay,
      adapter,
      inheritedAutosaveOptions,
    )
    delay.importState({ version: 1, smoothedIntervalMs: 190 })
    expect(vi.getTimerCount()).toBe(0)
    inheritedPersistence.dispose()

    const inheritedOnError = Object.create({ onError: vi.fn() })
    expect(() =>
      createAdaptiveDelayPersistence(delay, adapter, {
        autosave: inheritedOnError,
      } as AdaptiveDelayPersistenceOptions),
    ).toThrow('onError')

    const nullPrototypeAutosave = Object.assign(Object.create(null), { onError: vi.fn() })
    const nullPrototypeOptions = Object.assign(Object.create(null), {
      autosave: nullPrototypeAutosave,
    }) as AdaptiveDelayPersistenceOptions
    const nullPrototypePersistence = createAdaptiveDelayPersistence(
      delay,
      adapter,
      nullPrototypeOptions,
    )
    delay.importState({ version: 1, smoothedIntervalMs: 200 })
    expect(vi.getTimerCount()).toBe(1)
    expect(save).not.toHaveBeenCalled()
    nullPrototypePersistence.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
