import {
  type AdaptiveDebounceOptions,
  type AdaptiveDebounced,
  type AdaptiveDelay,
  type AdaptiveDelayImportResult,
  type AdaptiveDelayOptions,
  adaptiveDebounce,
  createAdaptiveDelay,
} from 'adaptive-debounce'
import { type ObserveTypingOptions, observeTyping } from 'adaptive-debounce/browser'
import {
  type AdaptiveDelayPersistence,
  type AdaptiveDelayPersistenceAdapter,
  createAdaptiveDelayPersistence,
} from 'adaptive-debounce/persistence'
import {
  type App,
  getCurrentScope,
  inject,
  type InjectionKey,
  onScopeDispose,
  type Plugin,
  readonly,
  shallowRef,
  type ShallowRef,
} from 'vue'

/** Stops one started Vue runtime. Calling it more than once has no effect. */
export type AdaptiveDebounceStop = () => void

/** Persistence configuration for one Vue application. */
export interface AdaptiveDebounceVuePersistenceOptions {
  /** Custom storage boundary. Omit it to use the core localStorage provider. */
  readonly adapter?: AdaptiveDelayPersistenceAdapter
  /** Saves one second after learned state changes. @defaultValue true */
  readonly autosave?: boolean
}

/** Configuration for {@link createAdaptiveDebouncePlugin}. */
export interface AdaptiveDebounceVueOptions {
  /** Existing shared delay or options used to create one. */
  readonly delay?: AdaptiveDelay | AdaptiveDelayOptions
  /** Browser observation options, or `false` to disable observation. @defaultValue {} */
  readonly observe?: false | ObserveTypingOptions
  /** Opt-in persistence using localStorage or a custom adapter. @defaultValue false */
  readonly persistence?: boolean | AdaptiveDebounceVuePersistenceOptions
  /** Starts after the root mounts. Nuxt sets this to `false`. @defaultValue true */
  readonly autoStart?: boolean
  /** Receives automatic start and autosave failures. */
  readonly onError?: (error: unknown) => void
}

const DELAY_KEYS = [
  'minimumDelayMs',
  'initialDelayMs',
  'maximumDelayMs',
  'smoothing',
  'intervalMultiplier',
  'quietPeriodMs',
  'idleResetMs',
  'clock',
] as const

/** The app-owned adaptive-debounce runtime injected by the Vue plugin. */
export interface AdaptiveDebounceRuntime {
  /** Shared timing learner for this Vue application. */
  readonly delay: AdaptiveDelay
  /** Manual persistence controls when persistence is enabled. */
  readonly persistence: AdaptiveDelayPersistence | undefined
  /** Loads persisted state, then starts browser observation. */
  start(): Promise<AdaptiveDebounceStop>
  /** Stops observation or invalidates a pending start without flushing work. */
  stop(): void
  /** Permanently stops this runtime and its persistence subscription. */
  dispose(): void
}

/** Options accepted by {@link useAdaptiveDebouncedFn}. */
export type AdaptiveDebouncedFnOptions = Omit<AdaptiveDebounceOptions, 'delay' | 'recordCalls'>

/** Typed app-level injection key used by the plugin and composables. */
export const adaptiveDebounceKey: InjectionKey<AdaptiveDebounceRuntime> =
  Symbol('adaptive-debounce')

interface InternalRuntime extends AdaptiveDebounceRuntime {
  report(error: unknown): void
}

interface ResolvedPersistenceOptions {
  readonly adapter: AdaptiveDelayPersistenceAdapter | undefined
  readonly autosave: boolean
}

interface PendingStart {
  readonly generation: number
  readonly promise: Promise<AdaptiveDebounceStop>
}

const NOOP_STOP: AdaptiveDebounceStop = () => undefined

/**
 * Creates a Vue plugin whose state belongs to each installed application.
 *
 * @example
 * ```ts
 * app.use(createAdaptiveDebouncePlugin({ persistence: true }))
 * ```
 */
export function createAdaptiveDebouncePlugin(options: AdaptiveDebounceVueOptions = {}): Plugin {
  return {
    install(app): void {
      if (getInstalledRuntime(app)) {
        return
      }

      const runtime = createRuntime(options)
      app.provide(adaptiveDebounceKey, runtime)
      app.onUnmount(runtime.dispose)

      if (options.autoStart !== false && typeof document !== 'undefined') {
        const mount = app.mount
        app.mount = function (...arguments_) {
          const instance = mount.apply(this, arguments_)
          if (instance !== undefined) {
            void runtime.start().catch(runtime.report)
          }
          return instance
        }
      }
    },
  }
}

/** Default Vue plugin with observation enabled and persistence disabled. */
export const adaptiveDebouncePlugin: Plugin = createAdaptiveDebouncePlugin()

/** Returns the runtime installed in the current Vue application. */
export function useAdaptiveDebounceRuntime(): AdaptiveDebounceRuntime {
  const runtime = inject(adaptiveDebounceKey)
  if (!runtime) {
    throw new Error(
      'Adaptive debounce is not installed. Call app.use(createAdaptiveDebouncePlugin()) first.',
    )
  }
  return runtime
}

/** Returns a readonly shallow ref that tracks the app's current adaptive delay. */
export function useAdaptiveDelay(): Readonly<ShallowRef<number>> {
  const delay = useAdaptiveDebounceRuntime().delay
  const delayMs = shallowRef(delay.getDelay())
  const unsubscribe = delay.subscribe((value) => {
    delayMs.value = value
  })

  if (getCurrentScope()) {
    onScopeDispose(unsubscribe)
  }

  return readonly(delayMs)
}

/**
 * Creates an independently cancellable debounced callback using the app's shared delay.
 *
 * Component-scope teardown cancels the callback without flushing it. Typing observation,
 * not wrapper calls, trains the shared delay.
 */
export function useAdaptiveDebouncedFn<This, Arguments extends unknown[], Result>(
  callback: (this: This, ...arguments_: Arguments) => Result,
  options: AdaptiveDebouncedFnOptions = {},
): AdaptiveDebounced<This, Arguments, Result> {
  const debounced = adaptiveDebounce(callback, {
    ...options,
    delay: useAdaptiveDebounceRuntime().delay,
    recordCalls: false,
  })

  if (getCurrentScope()) {
    onScopeDispose(() => debounced.cancel())
  }

  return debounced
}

function getInstalledRuntime(app: App): AdaptiveDebounceRuntime | undefined {
  return app.runWithContext(() => inject(adaptiveDebounceKey, undefined))
}

function createRuntime(options: AdaptiveDebounceVueOptions): InternalRuntime {
  validateOptions(options)

  const delay = isAdaptiveDelay(options.delay) ? options.delay : createAdaptiveDelay(options.delay)
  const observe = options.observe ?? {}
  const resolvedPersistence = resolvePersistence(options.persistence)
  const report = createReporter(options.onError)
  const persistenceControls = resolvedPersistence
    ? createPersistence(delay, resolvedPersistence, report)
    : undefined

  let generation = 0
  let disposed = false
  let loaded = false
  let activeStop: AdaptiveDebounceStop | undefined
  let pendingStart: PendingStart | undefined

  const invalidatePendingStart = (): void => {
    if (!pendingStart) {
      return
    }
    generation += 1
    pendingStart = undefined
  }

  const publicPersistence: AdaptiveDelayPersistence | undefined = persistenceControls
    ? {
        async load() {
          const result = await persistenceControls.load()
          loaded = true
          return result
        },
        save: () => persistenceControls.save(),
        flush: () => persistenceControls.flush(),
        async clear() {
          // Discard the staged profile without cancelling requested observation.
          loaded = true
          await persistenceControls.clear()
        },
        dispose: () => persistenceControls.dispose(),
      }
    : undefined

  const stop = (): void => {
    invalidatePendingStart()
    activeStop?.()
  }

  const start = (): Promise<AdaptiveDebounceStop> => {
    if (disposed) {
      return Promise.reject(new Error('Cannot start a disposed adaptive-debounce runtime.'))
    }
    if (activeStop) {
      return Promise.resolve(activeStop)
    }
    if (pendingStart) {
      return pendingStart.promise
    }

    const startGeneration = ++generation
    const promise = (async (): Promise<AdaptiveDebounceStop> => {
      if (resolvedPersistence && !loaded) {
        const stagedDelay = createAdaptiveDelay()
        const loader = createPersistence(
          stagedDelay,
          { ...resolvedPersistence, autosave: false },
          report,
        )
        let result: AdaptiveDelayImportResult | undefined
        try {
          result = await loader.load()
        } catch (error) {
          if (!disposed && generation === startGeneration) {
            report(error)
          }
        } finally {
          loader.dispose()
        }

        if (disposed || generation !== startGeneration) {
          return NOOP_STOP
        }
        if (!loaded) {
          if (result === 'imported') {
            delay.importState(stagedDelay.exportState())
          }
          loaded = result !== undefined
        }
      }

      if (disposed || generation !== startGeneration) {
        return NOOP_STOP
      }

      const stopObservation = observe === false ? undefined : observeTyping(delay, observe)
      let stopped = false
      const startedStop = (): void => {
        if (stopped) {
          return
        }
        stopped = true
        stopObservation?.()
        if (activeStop === startedStop) {
          activeStop = undefined
          generation += 1
        }
      }
      activeStop = startedStop
      return startedStop
    })()

    pendingStart = { generation: startGeneration, promise }
    void promise.then(
      () => finishStart(startGeneration, promise),
      () => finishStart(startGeneration, promise),
    )
    return promise
  }

  return {
    delay,
    persistence: publicPersistence,
    start,
    stop,
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      stop()
      persistenceControls?.dispose()
    },
    report,
  }

  function finishStart(startGeneration: number, finished: Promise<AdaptiveDebounceStop>): void {
    if (pendingStart?.generation === startGeneration && pendingStart.promise === finished) {
      pendingStart = undefined
    }
  }
}

function createPersistence(
  delay: AdaptiveDelay,
  options: ResolvedPersistenceOptions,
  onError: (error: unknown) => void,
): AdaptiveDelayPersistence {
  const persistenceOptions = options.autosave ? { autosave: { onError } } : undefined
  return options.adapter
    ? createAdaptiveDelayPersistence(delay, options.adapter, persistenceOptions)
    : createAdaptiveDelayPersistence(delay, persistenceOptions)
}

function resolvePersistence(
  persistence: AdaptiveDebounceVueOptions['persistence'],
): ResolvedPersistenceOptions | undefined {
  if (persistence === undefined || persistence === false) {
    return undefined
  }
  if (persistence === true) {
    return { adapter: undefined, autosave: true }
  }
  if (!isPlainObject(persistence)) {
    throw new TypeError('persistence must be a boolean or an options object.')
  }

  rejectUnknownKeys(persistence, ['adapter', 'autosave'], 'persistence')
  const autosave = persistence.autosave ?? true
  if (typeof autosave !== 'boolean') {
    throw new TypeError('persistence.autosave must be a boolean.')
  }
  const adapter = persistence.adapter
  if (adapter !== undefined && !isPersistenceAdapter(adapter)) {
    throw new TypeError('persistence.adapter must provide load, save, and clear methods.')
  }
  return { adapter, autosave }
}

function createReporter(onError: ((error: unknown) => void) | undefined) {
  return (error: unknown): void => {
    if (onError) {
      try {
        onError(error)
      } catch {
        // The application callback is the final automatic-error boundary.
      }
      return
    }

    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Adaptive debounce background operation failed.', error)
    }
  }
}

function validateOptions(options: AdaptiveDebounceVueOptions): void {
  if (!isPlainObject(options)) {
    throw new TypeError('Vue plugin options must be an object.')
  }
  rejectUnknownKeys(options, ['delay', 'observe', 'persistence', 'autoStart', 'onError'], 'Vue')

  if (options.autoStart !== undefined && typeof options.autoStart !== 'boolean') {
    throw new TypeError('autoStart must be a boolean.')
  }
  if (options.onError !== undefined && typeof options.onError !== 'function') {
    throw new TypeError('onError must be a function.')
  }
  if (
    options.observe !== undefined &&
    options.observe !== false &&
    !isPlainObject(options.observe)
  ) {
    throw new TypeError('observe must be false or an options object.')
  }
  if (isPlainObject(options.observe)) {
    rejectUnknownKeys(options.observe, ['root'], 'observe')
    const root = options.observe.root
    if (
      root !== undefined &&
      (!isObject(root) ||
        typeof root.addEventListener !== 'function' ||
        typeof root.removeEventListener !== 'function')
    ) {
      throw new TypeError('observe.root must support DOM event listeners.')
    }
  }
  if (options.delay !== undefined && !isAdaptiveDelay(options.delay)) {
    if (!isPlainObject(options.delay)) {
      throw new TypeError('delay must be an AdaptiveDelay or an options object.')
    }
    rejectUnknownKeys(options.delay, DELAY_KEYS, 'delay')
  }
}

function rejectUnknownKeys(value: object, supported: readonly string[], scope: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string' && supported.includes(key)) {
      continue
    }
    throw new TypeError(`${scope} options contain unsupported key "${String(key)}".`)
  }
  for (const key of supported) {
    if (!hasOwn(value, key) && key in value) {
      throw new TypeError(`${scope} options must define "${key}" as an own property.`)
    }
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Reflect.getOwnPropertyDescriptor(value, key) !== undefined
}

function isAdaptiveDelay(value: unknown): value is AdaptiveDelay {
  return (
    isObject(value) &&
    typeof value.record === 'function' &&
    typeof value.getDelay === 'function' &&
    typeof value.reset === 'function' &&
    typeof value.subscribe === 'function' &&
    typeof value.exportState === 'function' &&
    typeof value.importState === 'function'
  )
}

function isPersistenceAdapter(value: unknown): value is AdaptiveDelayPersistenceAdapter {
  return (
    isObject(value) &&
    typeof value.load === 'function' &&
    typeof value.save === 'function' &&
    typeof value.clear === 'function'
  )
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
