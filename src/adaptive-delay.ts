const DEFAULT_MINIMUM_DELAY_MS = 500
const DEFAULT_INITIAL_DELAY_MS = 750
const DEFAULT_MAXIMUM_DELAY_MS = 1_500
const DEFAULT_SMOOTHING = 0.25
const DEFAULT_INTERVAL_MULTIPLIER = 5
const DEFAULT_QUIET_PERIOD_MS = 350
const DEFAULT_IDLE_RESET_MS = 2_000
const DEFAULT_COLD_CADENCE_MS =
  (DEFAULT_INITIAL_DELAY_MS - DEFAULT_QUIET_PERIOD_MS) / DEFAULT_INTERVAL_MULTIPLIER

/** The result of attempting to restore an adaptive delay state. */
export type AdaptiveDelayImportResult = 'imported' | 'invalid' | 'unsupported-version'

/** The privacy-safe, versioned state exported by an adaptive delay. */
export interface AdaptiveDelayStateV1 {
  readonly version: 1
  readonly smoothedIntervalMs: number | null
}

/** Receives a new recommended delay after the exported state changes. */
export type AdaptiveDelayListener = (delayMs: number) => void

/** Configuration for {@link createAdaptiveDelay}. */
export interface AdaptiveDelayOptions {
  /** Smallest recommended delay, in milliseconds. @defaultValue 500 */
  readonly minimumDelayMs?: number
  /** Cold-start delay, in milliseconds. @defaultValue 750 */
  readonly initialDelayMs?: number
  /** Largest recommended delay, in milliseconds. @defaultValue 1500 */
  readonly maximumDelayMs?: number
  /** Maximum EWMA weight; mature relative changes use a smaller curved weight. @defaultValue 0.25 */
  readonly smoothing?: number
  /** Multiplier applied to the smoothed interval. @defaultValue 5 */
  readonly intervalMultiplier?: number
  /** Quiet pause added after the estimated word-time, in milliseconds. @defaultValue 350 */
  readonly quietPeriodMs?: number
  /** Gap that starts a new typing burst, in milliseconds. @defaultValue 2000 */
  readonly idleResetMs?: number
  /** Monotonic clock used by {@link AdaptiveDelay.record}. */
  readonly clock?: () => number
}

/** A bounded, DOM-free source of adaptive debounce delays. */
export interface AdaptiveDelay {
  /** Records one qualifying interaction at the current clock time. */
  record(): void
  /** Returns the current bounded delay recommendation, in milliseconds. */
  getDelay(): number
  /** Clears learned timing and the current burst baseline. */
  reset(): void
  /**
   * Subscribes to future exported-state changes.
   *
   * The listener is not called eagerly. The returned teardown is idempotent.
   * A reentrant state change supersedes the remaining notifications of older state.
   */
  subscribe(listener: AdaptiveDelayListener): () => void
  /** Returns a fresh privacy-safe state snapshot. */
  exportState(): AdaptiveDelayStateV1
  /** Atomically restores a supported state snapshot. */
  importState(state: unknown): AdaptiveDelayImportResult
}

interface ResolvedAdaptiveDelayOptions {
  readonly minimumDelayMs: number
  readonly initialDelayMs: number
  readonly maximumDelayMs: number
  readonly smoothing: number
  readonly intervalMultiplier: number
  readonly quietPeriodMs: number
  readonly coldCadenceMs: number
  readonly idleResetMs: number
  readonly clock: () => number
}

function defaultClock(): number {
  return globalThis.performance.now()
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number.`)
  }
}

function resolveOptions(options: AdaptiveDelayOptions | undefined): ResolvedAdaptiveDelayOptions {
  if (options === null || (options !== undefined && typeof options !== 'object')) {
    throw new TypeError('Adaptive delay options must be an object.')
  }

  const {
    minimumDelayMs = DEFAULT_MINIMUM_DELAY_MS,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maximumDelayMs = DEFAULT_MAXIMUM_DELAY_MS,
    smoothing = DEFAULT_SMOOTHING,
    intervalMultiplier = DEFAULT_INTERVAL_MULTIPLIER,
    quietPeriodMs = DEFAULT_QUIET_PERIOD_MS,
    idleResetMs = DEFAULT_IDLE_RESET_MS,
    clock = defaultClock,
  } = options ?? {}

  assertFiniteNumber(minimumDelayMs, 'minimumDelayMs')
  assertFiniteNumber(initialDelayMs, 'initialDelayMs')
  assertFiniteNumber(maximumDelayMs, 'maximumDelayMs')
  assertFiniteNumber(smoothing, 'smoothing')
  assertFiniteNumber(intervalMultiplier, 'intervalMultiplier')
  assertFiniteNumber(quietPeriodMs, 'quietPeriodMs')
  assertFiniteNumber(idleResetMs, 'idleResetMs')

  if (minimumDelayMs < 0) {
    throw new RangeError('minimumDelayMs must be greater than or equal to 0.')
  }
  if (maximumDelayMs < minimumDelayMs) {
    throw new RangeError('maximumDelayMs must be greater than or equal to minimumDelayMs.')
  }
  if (initialDelayMs < minimumDelayMs || initialDelayMs > maximumDelayMs) {
    throw new RangeError('initialDelayMs must be between minimumDelayMs and maximumDelayMs.')
  }
  if (smoothing <= 0 || smoothing > 1) {
    throw new RangeError('smoothing must be greater than 0 and at most 1.')
  }
  if (intervalMultiplier <= 0) {
    throw new RangeError('intervalMultiplier must be greater than 0.')
  }
  if (quietPeriodMs < 0) {
    throw new RangeError('quietPeriodMs must be greater than or equal to 0.')
  }
  if (idleResetMs <= 0) {
    throw new RangeError('idleResetMs must be greater than 0.')
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function.')
  }

  const coldCadenceMs = (initialDelayMs - quietPeriodMs) / intervalMultiplier

  return {
    minimumDelayMs,
    initialDelayMs,
    maximumDelayMs,
    smoothing,
    intervalMultiplier,
    quietPeriodMs,
    coldCadenceMs:
      Number.isFinite(coldCadenceMs) && coldCadenceMs > 0 ? coldCadenceMs : DEFAULT_COLD_CADENCE_MS,
    idleResetMs,
    clock,
  }
}

function parseImportedState(
  state: unknown,
): AdaptiveDelayStateV1 | Exclude<AdaptiveDelayImportResult, 'imported'> {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return 'invalid'
  }

  try {
    const candidate = state as {
      readonly version?: unknown
      readonly smoothedIntervalMs?: unknown
    }

    if (!Number.isInteger(candidate.version)) {
      return 'invalid'
    }
    if (candidate.version !== 1) {
      return 'unsupported-version'
    }

    const keys = Reflect.ownKeys(state)
    if (keys.length !== 2 || !keys.includes('version') || !keys.includes('smoothedIntervalMs')) {
      return 'invalid'
    }

    const smoothedIntervalMs = candidate.smoothedIntervalMs
    if (
      smoothedIntervalMs !== null &&
      (typeof smoothedIntervalMs !== 'number' ||
        !Number.isFinite(smoothedIntervalMs) ||
        smoothedIntervalMs <= 0)
    ) {
      return 'invalid'
    }

    return { version: 1, smoothedIntervalMs }
  } catch {
    return 'invalid'
  }
}

/**
 * Creates an instance-local adaptive delay using a clipped EWMA.
 *
 * @example
 * ```ts
 * const delay = createAdaptiveDelay()
 * delay.record()
 * console.log(delay.getDelay())
 * ```
 */
export function createAdaptiveDelay(options?: AdaptiveDelayOptions): AdaptiveDelay {
  const {
    minimumDelayMs,
    initialDelayMs,
    maximumDelayMs,
    smoothing,
    intervalMultiplier,
    quietPeriodMs,
    coldCadenceMs,
    idleResetMs,
    clock,
  } = resolveOptions(options)

  let smoothedIntervalMs: number | null = null
  let lastRecordedAtMs: number | null = null
  let notificationVersion = 0
  const listeners = new Set<AdaptiveDelayListener>()

  const getDelay = (): number => {
    if (smoothedIntervalMs === null) {
      return initialDelayMs
    }

    return Math.min(
      maximumDelayMs,
      Math.max(minimumDelayMs, smoothedIntervalMs * intervalMultiplier + quietPeriodMs),
    )
  }

  const notify = (): void => {
    const version = ++notificationVersion
    const delayMs = getDelay()
    let firstError: unknown
    let hasError = false

    for (const listener of [...listeners]) {
      if (version !== notificationVersion) {
        break
      }
      try {
        listener(delayMs)
      } catch (error) {
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

  const commit = (nextSmoothedIntervalMs: number | null): void => {
    if (Object.is(smoothedIntervalMs, nextSmoothedIntervalMs)) {
      return
    }

    smoothedIntervalMs = nextSmoothedIntervalMs
    notify()
  }

  const record = (): void => {
    const recordedAtMs = clock()
    if (!Number.isFinite(recordedAtMs)) {
      throw new RangeError('clock must return a finite number.')
    }

    if (lastRecordedAtMs === null) {
      lastRecordedAtMs = recordedAtMs
      return
    }
    if (recordedAtMs < lastRecordedAtMs) {
      throw new RangeError('clock must not move backwards.')
    }
    if (recordedAtMs === lastRecordedAtMs) {
      return
    }

    const intervalMs = recordedAtMs - lastRecordedAtMs
    if (!Number.isFinite(intervalMs)) {
      throw new RangeError('clock must advance by a finite interval.')
    }

    lastRecordedAtMs = recordedAtMs
    if (intervalMs >= idleResetMs) {
      return
    }

    const currentIntervalMs = smoothedIntervalMs ?? coldCadenceMs
    const clippedIntervalMs = Math.min(
      currentIntervalMs * 2,
      Math.max(currentIntervalMs * 0.5, intervalMs),
    )
    const errorMs = clippedIntervalMs - currentIntervalMs
    const relativeError = Math.abs(errorMs) / currentIntervalMs
    const effectiveSmoothing =
      smoothedIntervalMs === null ? smoothing : smoothing / (1 + 2 * relativeError)
    commit(currentIntervalMs + effectiveSmoothing * errorMs)
  }

  const reset = (): void => {
    lastRecordedAtMs = null
    commit(null)
  }

  const subscribe = (listener: AdaptiveDelayListener): (() => void) => {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function.')
    }

    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const exportState = (): AdaptiveDelayStateV1 => ({
    version: 1,
    smoothedIntervalMs,
  })

  const importState = (state: unknown): AdaptiveDelayImportResult => {
    const imported = parseImportedState(state)
    if (typeof imported === 'string') {
      return imported
    }

    lastRecordedAtMs = null
    commit(imported.smoothedIntervalMs)
    return 'imported'
  }

  return {
    record,
    getDelay,
    reset,
    subscribe,
    exportState,
    importState,
  }
}
