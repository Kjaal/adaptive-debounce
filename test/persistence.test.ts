import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdaptiveDelay } from '../src/adaptive-delay'
import {
  type AdaptiveDelayPersistenceAdapter,
  createAdaptiveDelayPersistence,
} from '../src/persistence'

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
})

describe('createAdaptiveDelayPersistence', () => {
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

  it('does not let a load that clear superseded restore old state', async () => {
    const read = deferred<unknown>()
    const adapter: AdaptiveDelayPersistenceAdapter = {
      load: () => read.promise,
      save: () => undefined,
      clear: () => undefined,
    }
    const delay = createAdaptiveDelay()
    const persistence = createAdaptiveDelayPersistence(delay, adapter)

    const loading = persistence.load()
    const clearing = persistence.clear()
    read.resolve({ version: 1, smoothedIntervalMs: 200 })

    await expect(loading).resolves.toBe('invalid')
    await clearing
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
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

    expect(() => createAdaptiveDelayPersistence(delay, null as never)).toThrow('adapter')
    expect(() => createAdaptiveDelayPersistence(delay, adapter, { autosave: {} as never })).toThrow(
      'onError',
    )
  })
})
