import {
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
  createContext,
  createElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

const MISSING_PROVIDER_MESSAGE =
  'Adaptive debounce hooks require an <AdaptiveDebounceProvider> above the calling component.'
const INACTIVE_PERSISTENCE_MESSAGE =
  'Adaptive debounce persistence is not active; enable the Provider persistence option and call this method after mount.'

/** Application-owned persistence configuration for {@link AdaptiveDebounceProvider}. */
export interface AdaptiveDebouncePersistenceOptions {
  /** Custom storage boundary. Omit it to use the core package's browser localStorage adapter. */
  readonly adapter?: AdaptiveDelayPersistenceAdapter
}

/** Shared configuration for {@link AdaptiveDebounceProvider}. */
export interface AdaptiveDebounceProviderOptions {
  /** Initial learner configuration. Remount the Provider to replace it. */
  readonly delay?: AdaptiveDelayOptions
  /** Browser typing observation. Defaults to the current document; pass `false` to disable it. */
  readonly observation?: boolean | ObserveTypingOptions
  /** Enables one-second autosave. Pass an object to provide a custom adapter. */
  readonly persistence?: boolean | AdaptiveDebouncePersistenceOptions
  /** Receives automatic observer, load, and autosave failures. */
  readonly onError?: (error: unknown) => void
}

/** Props for {@link AdaptiveDebounceProvider}. */
export interface AdaptiveDebounceProviderProps extends AdaptiveDebounceProviderOptions {
  /** Application subtree sharing this Provider's learner. */
  readonly children?: ReactNode
}

/** App-scoped adaptive state and explicit persistence controls. */
export interface AdaptiveDebounceRuntime {
  /** Shared adaptive delay used by this Provider. */
  readonly delay: AdaptiveDelay
  /** Loads the active persistence adapter and imports a supported profile. */
  load(): Promise<AdaptiveDelayImportResult>
  /** Runs a scheduled autosave immediately and waits for queued writes. */
  flush(): Promise<void>
  /** Resets learned state and clears the active persistence adapter. */
  clear(): Promise<void>
}

/** Timing controls for {@link useAdaptiveDebouncedCallback}. */
export interface AdaptiveDebouncedCallbackOptions {
  /** Invoke immediately when a new window opens. @defaultValue false */
  readonly leading?: boolean
  /** Invoke after calls stop. @defaultValue true */
  readonly trailing?: boolean
  /** Hard upper bound for an open window, in milliseconds. */
  readonly maxWait?: number
}

const PROVIDER_KEYS = ['children', 'delay', 'observation', 'persistence', 'onError', 'key'] as const
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

interface InternalRuntime extends AdaptiveDebounceRuntime {
  readonly coldDelayMs: number
  begin(): number
  attach(generation: number, persistence: AdaptiveDelayPersistence): void
  end(generation: number): void
  isCurrent(generation: number): boolean
}

const AdaptiveDebounceContext = createContext<InternalRuntime | null>(null)

/**
 * Provides one isolated adaptive learner to a React application subtree.
 *
 * @example
 * ```tsx
 * <AdaptiveDebounceProvider persistence>
 *   <App />
 * </AdaptiveDebounceProvider>
 * ```
 */
export function AdaptiveDebounceProvider(props: AdaptiveDebounceProviderProps): ReactElement {
  validateProviderProps(props)
  const { children, delay: delayOptions, observation, persistence, onError } = props
  const runtimeReference = useRef<InternalRuntime | null>(null)
  if (runtimeReference.current === null) {
    runtimeReference.current = createRuntime(delayOptions)
  }
  const runtime = runtimeReference.current

  const errorHandlerReference = useRef(onError)
  errorHandlerReference.current = onError

  const observationOptions =
    typeof observation === 'object' && observation !== null ? observation : undefined
  const observationEnabled = observation !== false
  const observationRoot = observationOptions?.root
  const persistenceOptions =
    typeof persistence === 'object' && persistence !== null ? persistence : undefined
  const persistenceEnabled = persistence === true || persistenceOptions !== undefined
  const persistenceAdapter = persistenceOptions?.adapter

  useEffect(() => {
    const generation = runtime.begin()
    const report = (error: unknown): void =>
      reportAutomaticError(error, errorHandlerReference.current)
    let stopObserving: (() => void) | undefined
    let persistenceControls: AdaptiveDelayPersistence | undefined

    if (persistenceEnabled) {
      try {
        const guardedDelay = createGuardedDelay(runtime, generation)
        const options = { autosave: { onError: report } }
        persistenceControls = persistenceAdapter
          ? createAdaptiveDelayPersistence(guardedDelay, persistenceAdapter, options)
          : createAdaptiveDelayPersistence(guardedDelay, options)
        runtime.attach(generation, persistenceControls)
      } catch (error) {
        report(error)
      }
    }

    const start = async (): Promise<void> => {
      if (persistenceControls) {
        try {
          await persistenceControls.load()
        } catch (error) {
          report(error)
        }
      }

      if (!runtime.isCurrent(generation) || !observationEnabled) {
        return
      }

      try {
        stopObserving = observationRoot
          ? observeTyping(runtime.delay, { root: observationRoot })
          : observeTyping(runtime.delay)
      } catch (error) {
        report(error)
      }
    }

    void start()

    return () => {
      runtime.end(generation)
      stopObserving?.()
      persistenceControls?.dispose()
    }
  }, [observationEnabled, observationRoot, persistenceAdapter, persistenceEnabled, runtime])

  return createElement(AdaptiveDebounceContext.Provider, { value: runtime }, children)
}

/** Returns the nearest Provider's isolated runtime. */
export function useAdaptiveDebounceRuntime(): AdaptiveDebounceRuntime {
  const runtime = useContext(AdaptiveDebounceContext)
  if (runtime === null) {
    throw new Error(MISSING_PROVIDER_MESSAGE)
  }

  return runtime
}

/** Subscribes to the nearest Provider's current recommended delay. */
export function useAdaptiveDelay(): number {
  const runtime = useInternalRuntime()
  return useSyncExternalStore(
    runtime.delay.subscribe,
    runtime.delay.getDelay,
    () => runtime.coldDelayMs,
  )
}

/**
 * Creates an independent debounced callback backed by the Provider's shared delay.
 *
 * The returned callback and controls stay stable when only the callback closure changes. Pending
 * work is cancelled when timing options change or the component unmounts.
 */
export function useAdaptiveDebouncedCallback<This, Arguments extends unknown[], Result>(
  callback: (this: This, ...arguments_: Arguments) => Result,
  options?: AdaptiveDebouncedCallbackOptions,
): AdaptiveDebounced<This, Arguments, Result> {
  const runtime = useInternalRuntime()
  const callbackReference = useRef(callback)
  callbackReference.current = callback

  const leading = options?.leading ?? false
  const trailing = options?.trailing ?? true
  const maxWait = options?.maxWait
  const debounced = useMemo(
    () =>
      adaptiveDebounce(
        function (this: This, ...arguments_: Arguments): Result {
          return callbackReference.current.apply(this, arguments_)
        },
        {
          delay: runtime.delay,
          recordCalls: false,
          leading,
          trailing,
          ...(maxWait === undefined ? {} : { maxWait }),
        },
      ),
    [leading, maxWait, runtime, trailing],
  )

  useEffect(
    () => () => {
      debounced.cancel()
    },
    [debounced],
  )

  return debounced
}

function useInternalRuntime(): InternalRuntime {
  const runtime = useContext(AdaptiveDebounceContext)
  if (runtime === null) {
    throw new Error(MISSING_PROVIDER_MESSAGE)
  }

  return runtime
}

function createRuntime(options: AdaptiveDelayOptions | undefined): InternalRuntime {
  const delay = createAdaptiveDelay(options)
  const coldDelayMs = delay.getDelay()
  let generation = 0
  let activePersistence: AdaptiveDelayPersistence | undefined

  const requirePersistence = (): AdaptiveDelayPersistence => {
    if (!activePersistence) {
      throw new Error(INACTIVE_PERSISTENCE_MESSAGE)
    }

    return activePersistence
  }

  const runWithPersistence = <Result>(
    operation: (persistence: AdaptiveDelayPersistence) => Promise<Result>,
  ): Promise<Result> => {
    try {
      return operation(requirePersistence())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  return {
    delay,
    coldDelayMs,
    load: () => runWithPersistence((persistence) => persistence.load()),
    flush: () => runWithPersistence((persistence) => persistence.flush()),
    clear: () => runWithPersistence((persistence) => persistence.clear()),
    begin(): number {
      generation += 1
      activePersistence = undefined
      return generation
    },
    attach(attachedGeneration, persistence): void {
      if (attachedGeneration === generation) {
        activePersistence = persistence
      }
    },
    end(endedGeneration): void {
      if (endedGeneration === generation) {
        generation += 1
        activePersistence = undefined
      }
    },
    isCurrent(candidateGeneration): boolean {
      return candidateGeneration === generation
    },
  }
}

function createGuardedDelay(runtime: InternalRuntime, generation: number): AdaptiveDelay {
  const { delay } = runtime
  return {
    record: delay.record,
    getDelay: delay.getDelay,
    reset: delay.reset,
    subscribe: delay.subscribe,
    exportState: delay.exportState,
    importState: (state) => (runtime.isCurrent(generation) ? delay.importState(state) : 'invalid'),
  }
}

function reportAutomaticError(
  error: unknown,
  handler: ((error: unknown) => void) | undefined,
): void {
  if (handler) {
    try {
      handler(error)
      return
    } catch (handlerError) {
      error = handlerError
    }
  }

  if (typeof globalThis.reportError === 'function') {
    try {
      globalThis.reportError(error)
      return
    } catch {
      // Fall through to the last safe reporting boundary.
    }
  }

  try {
    globalThis.console?.error(error)
  } catch {
    // Reporting must never turn a background failure into an unhandled exception.
  }
}

function validateProviderProps(props: unknown): asserts props is AdaptiveDebounceProviderProps {
  if (!isPlainObject(props)) {
    throw new TypeError('AdaptiveDebounceProvider props must be a plain object.')
  }
  rejectUnknownKeys(props, PROVIDER_KEYS, 'AdaptiveDebounceProvider props')

  const delay = props.delay
  if (delay !== undefined) {
    if (!isPlainObject(delay)) {
      throw new TypeError('delay must be a plain options object.')
    }
    rejectUnknownKeys(delay, DELAY_KEYS, 'delay options')
  }

  const observation = props.observation
  if (observation !== undefined && typeof observation !== 'boolean') {
    if (!isPlainObject(observation)) {
      throw new TypeError('observation must be a boolean or a plain options object.')
    }
    rejectUnknownKeys(observation, ['root'], 'observation options')
    const root = observation.root
    if (
      root !== undefined &&
      (!isObject(root) ||
        typeof root.addEventListener !== 'function' ||
        typeof root.removeEventListener !== 'function')
    ) {
      throw new TypeError('observation.root must support DOM event listeners.')
    }
  }

  const persistence = props.persistence
  if (persistence !== undefined && typeof persistence !== 'boolean') {
    if (!isPlainObject(persistence)) {
      throw new TypeError('persistence must be a boolean or a plain options object.')
    }
    rejectUnknownKeys(persistence, ['adapter'], 'persistence options')
    const adapter = persistence.adapter
    if (
      adapter !== undefined &&
      (!isObject(adapter) ||
        typeof adapter.load !== 'function' ||
        typeof adapter.save !== 'function' ||
        typeof adapter.clear !== 'function')
    ) {
      throw new TypeError('persistence.adapter must provide load, save, and clear methods.')
    }
  }

  if (props.onError !== undefined && typeof props.onError !== 'function') {
    throw new TypeError('onError must be a function.')
  }
}

function rejectUnknownKeys(value: object, supported: readonly string[], scope: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string' && supported.includes(key)) {
      continue
    }
    throw new TypeError(`${scope} contain unsupported key "${String(key)}".`)
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
