import type {
  AdaptiveDelay,
  AdaptiveDelayImportResult,
  AdaptiveDelayStateV1,
} from './adaptive-delay.js'

const AUTOSAVE_WAIT_MS = 1_000
const LOCAL_STORAGE_KEY = 'adaptive-debounce:state'
const LOCAL_STORAGE_UNAVAILABLE_MESSAGE =
  'Built-in persistence requires browser localStorage; call persistence methods during a client lifecycle or pass a custom adapter.'

/** A custom storage boundary whose implementation owns keys, serialization, and access policy. */
export interface AdaptiveDelayPersistenceAdapter {
  /** Reads untrusted persisted data. */
  load(): unknown | PromiseLike<unknown>
  /** Writes one privacy-safe adaptive-delay state snapshot. */
  save(state: AdaptiveDelayStateV1): void | PromiseLike<void>
  /** Removes the persisted state. */
  clear(): void | PromiseLike<void>
}

/** Configuration for trailing persistence after adaptive state changes. */
export interface AdaptiveDelayAutosaveOptions {
  /** Receives failures from background writes. */
  readonly onError: (error: unknown) => void
}

/** Configuration for {@link createAdaptiveDelayPersistence}. */
export interface AdaptiveDelayPersistenceOptions {
  /** Enables trailing autosave with a fixed 1,000 ms wait. */
  readonly autosave?: AdaptiveDelayAutosaveOptions
}

/** Manual persistence controls for one adaptive-delay instance. */
export interface AdaptiveDelayPersistence {
  /**
   * Loads and atomically imports an adapter value. Concurrent loads share one promise; a load
   * rejects while a clear is pending.
   */
  load(): Promise<AdaptiveDelayImportResult>
  /** Queues the current state for a serialized write. */
  save(): Promise<void>
  /** Immediately runs a scheduled autosave and waits for queued writes. */
  flush(): Promise<void>
  /**
   * Resets memory immediately and clears persisted state after older writes. Concurrent clears
   * share one promise; a clear during a load invalidates that load before clearing the adapter.
   */
  clear(): Promise<void>
  /** Stops autosave without implicitly saving. Idempotent. */
  dispose(): void
}

interface SaveBatch {
  state: AdaptiveDelayStateV1
  readonly generation: number
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

const localStorageAdapter: AdaptiveDelayPersistenceAdapter = {
  load(): unknown {
    const serialized = getLocalStorage().getItem(LOCAL_STORAGE_KEY)
    if (serialized === null) {
      return undefined
    }

    try {
      return JSON.parse(serialized)
    } catch {
      return undefined
    }
  },
  save(state): void {
    getLocalStorage().setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        version: state.version,
        smoothedIntervalMs: state.smoothedIntervalMs,
      }),
    )
  },
  clear(): void {
    getLocalStorage().removeItem(LOCAL_STORAGE_KEY)
  },
}

/**
 * Connects an adaptive delay to browser localStorage or a custom persistence adapter.
 *
 * The built-in adapter uses the same-origin `adaptive-debounce:state` key. Creating the controls is
 * SSR-safe; call storage operations during a client lifecycle. Loading and saving remain explicit
 * unless autosave is enabled.
 *
 * @example
 * ```ts
 * const persistence = createAdaptiveDelayPersistence(delay)
 * await persistence.load()
 * await persistence.save()
 * ```
 */
export function createAdaptiveDelayPersistence(
  delay: AdaptiveDelay,
  options?: AdaptiveDelayPersistenceOptions,
): AdaptiveDelayPersistence
export function createAdaptiveDelayPersistence(
  delay: AdaptiveDelay,
  adapter: AdaptiveDelayPersistenceAdapter,
  options?: AdaptiveDelayPersistenceOptions,
): AdaptiveDelayPersistence
export function createAdaptiveDelayPersistence(
  delay: AdaptiveDelay,
  adapterOrOptions?: AdaptiveDelayPersistenceAdapter | AdaptiveDelayPersistenceOptions,
  options?: AdaptiveDelayPersistenceOptions,
): AdaptiveDelayPersistence {
  validateDelay(delay)

  let adapter: AdaptiveDelayPersistenceAdapter
  let persistenceOptions: AdaptiveDelayPersistenceOptions | undefined
  if (options !== undefined || hasAdapterMember(adapterOrOptions)) {
    validateAdapter(adapterOrOptions)
    adapter = adapterOrOptions
    persistenceOptions = options
  } else {
    adapter = localStorageAdapter
    persistenceOptions = adapterOrOptions as AdaptiveDelayPersistenceOptions | undefined
  }

  const autosave = validateOptions(persistenceOptions)

  let generation = 0
  let disposed = false
  let suppressAutosave = false
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSave: SaveBatch | undefined
  let drainPromise: Promise<void> | undefined
  let pendingLoad: Promise<AdaptiveDelayImportResult> | undefined
  let pendingClear: Promise<void> | undefined
  let operationTail = Promise.resolve()

  const serialize = <Result>(operation: () => Result | PromiseLike<Result>): Promise<Result> => {
    const result = operationTail.then(operation, operation)
    operationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const drainSaves = async (): Promise<void> => {
    let firstError: unknown
    let hasError = false

    while (pendingSave) {
      const batch = pendingSave
      pendingSave = undefined

      if (batch.generation !== generation) {
        batch.resolve()
        continue
      }

      try {
        await serialize(() => adapter.save(batch.state))
        batch.resolve()
      } catch (error) {
        batch.reject(error)
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }

    if (hasError) {
      throw firstError
    }
  }

  const startDrain = (): Promise<void> => {
    if (drainPromise) {
      return drainPromise
    }

    const running = drainSaves()
    drainPromise = running
    void running.then(
      () => finishDrain(running),
      () => finishDrain(running),
    )
    return running
  }

  const finishDrain = (finished: Promise<void>): void => {
    if (drainPromise !== finished) {
      return
    }

    drainPromise = undefined
    if (pendingSave) {
      void startDrain().catch(() => undefined)
    }
  }

  const enqueueSave = (): Promise<void> => {
    const state = delay.exportState()

    if (pendingSave?.generation === generation) {
      pendingSave.state = state
      return pendingSave.promise
    }

    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const batch = { state, generation, promise, resolve, reject }
    pendingSave = batch

    void startDrain().catch(() => undefined)
    return batch.promise
  }

  const cancelAutosave = (): boolean => {
    if (autosaveTimer === undefined) {
      return false
    }

    clearTimeout(autosaveTimer)
    autosaveTimer = undefined
    return true
  }

  const reportAutosaveError = (error: unknown): void => {
    try {
      autosave?.onError(error)
    } catch {
      // The application-owned callback is the final background error boundary.
    }
  }

  const scheduleAutosave = (): void => {
    if (!autosave || disposed || suppressAutosave) {
      return
    }

    cancelAutosave()
    autosaveTimer = setTimeout(() => {
      autosaveTimer = undefined
      void enqueueSave().catch(reportAutosaveError)
    }, AUTOSAVE_WAIT_MS)
  }

  const unsubscribe = autosave ? delay.subscribe(scheduleAutosave) : undefined

  const runLoad = async (): Promise<AdaptiveDelayImportResult> => {
    const loadGeneration = generation
    const state = await serialize(() => adapter.load())
    if (loadGeneration !== generation) {
      return 'invalid'
    }

    suppressAutosave = true
    try {
      return delay.importState(state)
    } finally {
      suppressAutosave = false
    }
  }

  const finishLoad = (finished: Promise<AdaptiveDelayImportResult>): void => {
    if (pendingLoad === finished) {
      pendingLoad = undefined
    }
  }

  const load = (): Promise<AdaptiveDelayImportResult> => {
    if (pendingClear) {
      return rejectLifecycleConflict('load', 'clear')
    }
    if (pendingLoad) {
      return pendingLoad
    }

    const promise = runLoad()
    pendingLoad = promise
    void promise.then(
      () => finishLoad(promise),
      () => finishLoad(promise),
    )
    return promise
  }

  const flush = async (): Promise<void> => {
    const scheduledSave = cancelAutosave() ? enqueueSave() : undefined
    const activeDrain = drainPromise

    if (scheduledSave && activeDrain) {
      await Promise.all([scheduledSave, activeDrain])
    } else {
      await (scheduledSave ?? activeDrain)
    }
  }

  const runClear = async (): Promise<void> => {
    generation += 1
    cancelAutosave()
    const supersededSave = pendingSave
    pendingSave = undefined

    let resetError: unknown
    let resetFailed = false
    suppressAutosave = true
    try {
      delay.reset()
    } catch (error) {
      resetError = error
      resetFailed = true
    } finally {
      suppressAutosave = false
    }

    try {
      await serialize(() => adapter.clear())
      if (supersededSave) {
        supersededSave.resolve()
      }
    } catch (error) {
      if (supersededSave) {
        supersededSave.reject(error)
      }
      throw error
    }

    if (resetFailed) {
      throw resetError
    }
  }

  const finishClear = (finished: Promise<void>): void => {
    if (pendingClear === finished) {
      pendingClear = undefined
    }
  }

  const clear = (): Promise<void> => {
    if (pendingClear) {
      return pendingClear
    }

    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    pendingClear = promise
    void runClear().then(resolve, reject)
    void promise.then(
      () => finishClear(promise),
      () => finishClear(promise),
    )
    return promise
  }

  return {
    load,
    save: enqueueSave,
    flush,
    clear,
    dispose(): void {
      if (disposed) {
        return
      }

      disposed = true
      cancelAutosave()
      unsubscribe?.()
    },
  }
}

function validateDelay(delay: AdaptiveDelay): void {
  if (
    !isObject(delay) ||
    typeof delay.reset !== 'function' ||
    typeof delay.subscribe !== 'function' ||
    typeof delay.exportState !== 'function' ||
    typeof delay.importState !== 'function'
  ) {
    throw new TypeError('delay must be an AdaptiveDelay.')
  }
}

function validateAdapter(adapter: unknown): asserts adapter is AdaptiveDelayPersistenceAdapter {
  if (
    !isObject(adapter) ||
    !('load' in adapter) ||
    !('save' in adapter) ||
    !('clear' in adapter) ||
    typeof adapter.load !== 'function' ||
    typeof adapter.save !== 'function' ||
    typeof adapter.clear !== 'function'
  ) {
    throw new TypeError('adapter must provide load, save, and clear methods.')
  }
}

function hasAdapterMember(value: unknown): boolean {
  return isObject(value) && ('load' in value || 'save' in value || 'clear' in value)
}

function validateOptions(
  options: AdaptiveDelayPersistenceOptions | undefined,
): AdaptiveDelayAutosaveOptions | undefined {
  if (options === undefined) {
    return undefined
  }
  if (!isObject(options)) {
    throw new TypeError('persistence options must be an object.')
  }
  rejectUnknownKeys(options, ['autosave'], 'persistence')

  if (!hasOwn(options, 'autosave')) {
    return undefined
  }
  const { autosave } = options
  if (autosave === undefined) {
    return undefined
  }
  if (!isObject(autosave)) {
    throw new TypeError('autosave requires an onError callback.')
  }
  rejectUnknownKeys(autosave, ['onError'], 'autosave')
  if (!hasOwn(autosave, 'onError') || typeof autosave.onError !== 'function') {
    throw new TypeError('autosave requires an onError callback.')
  }

  return autosave
}

function rejectUnknownKeys(value: object, supportedKeys: readonly string[], scope: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string' && supportedKeys.includes(key)) {
      continue
    }

    throw new TypeError(
      `${scope} options contain unsupported key "${String(key)}"; pass a custom adapter for scoped keys or storage backends.`,
    )
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Reflect.getOwnPropertyDescriptor(value, key) !== undefined
}

function rejectLifecycleConflict(
  requested: 'load' | 'clear',
  active: 'load' | 'clear',
): Promise<never> {
  return Promise.reject(
    new Error(
      `Cannot start ${requested}: ${active} operation already pending. Await it before starting another load or clear.`,
    ),
  )
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function getLocalStorage(): Storage {
  const storage = globalThis.localStorage
  if (!storage) {
    throw new Error(LOCAL_STORAGE_UNAVAILABLE_MESSAGE)
  }
  return storage
}
