import { type AdaptiveDelay, createAdaptiveDelay } from './adaptive-delay.js'

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** A fixed delay up to 2,147,483,647 milliseconds or a live adaptive delay source. */
export type AdaptiveDebounceDelay = number | AdaptiveDelay

/** Controls when an adaptive debounced callback runs. */
export interface AdaptiveDebounceOptions {
  /** Fixed or adaptive delay; sampled values must not exceed 2,147,483,647 milliseconds. Omit it to use a private adaptive delay. */
  readonly delay?: AdaptiveDebounceDelay
  /** Whether each wrapper call records against an adaptive delay. Defaults to true for adaptive delays. */
  readonly recordCalls?: boolean
  /** Invoke immediately when a new window opens. Defaults to `false`. */
  readonly leading?: boolean
  /** Invoke after calls stop. Defaults to `true`. */
  readonly trailing?: boolean
  /** Hard upper bound for an open window, up to 2,147,483,647 milliseconds. */
  readonly maxWait?: number
}

/** A promise-returning debounced callback with lifecycle controls. */
export interface AdaptiveDebounced<This, Arguments extends unknown[], Result> {
  (this: This, ...arguments_: Arguments): Promise<Awaited<Result>>
  /** Reject and close the current window without cancelling started work. */
  cancel(reason?: unknown): void
  /** Close the current window now and return its shared promise. */
  flush(): Promise<Awaited<Result>> | undefined
  /** Whether calls are currently sharing an open debounce window. */
  pending(): boolean
}

interface NormalizedOptions {
  readonly delay: AdaptiveDebounceDelay
  readonly recordCalls: boolean
  readonly leading: boolean
  readonly trailing: boolean
  readonly maxWait: number | undefined
}

interface Fulfilled<Value> {
  readonly fulfilled: true
  readonly value: Value
}

interface Rejected {
  readonly fulfilled: false
  readonly reason: unknown
}

type Outcome<Value> = Fulfilled<Value> | Rejected

interface DebounceWindow<This, Arguments extends unknown[], Result> {
  latestArguments: Arguments
  latestThis: This
  calls: number
  settled: boolean
  finishWithLeading: boolean
  waitTimer: ReturnType<typeof setTimeout> | undefined
  maxTimer: ReturnType<typeof setTimeout> | undefined
  leadingOutcome: Promise<Outcome<Awaited<Result>>> | undefined
  readonly promise: Promise<Awaited<Result>>
  readonly resolve: (value: Awaited<Result> | PromiseLike<Awaited<Result>>) => void
  readonly reject: (reason?: unknown) => void
}

/**
 * Debounces a callback with a fixed or adaptive delay.
 *
 * Calls in one window share a promise and use the latest arguments and `this`.
 * A leading-only callback that reenters its wrapper rejects that window with a
 * `TypeError` to prevent direct and async promise-adoption cycles.
 * Fixed, adaptive, and maximum-wait durations cannot exceed 2,147,483,647 milliseconds.
 *
 * @example
 * ```ts
 * const search = adaptiveDebounce((query: string) => fetchResults(query), 300)
 * const results = await search('latest query')
 * ```
 */
export function adaptiveDebounce<This, Arguments extends unknown[], Result>(
  callback: (this: This, ...arguments_: Arguments) => Result,
  delayOrOptions?: AdaptiveDebounceDelay | AdaptiveDebounceOptions,
): AdaptiveDebounced<This, Arguments, Result> {
  if (typeof callback !== 'function') {
    throw new TypeError('adaptiveDebounce callback must be a function')
  }

  const options = normalizeOptions(delayOrOptions)
  let activeWindow: DebounceWindow<This, Arguments, Result> | undefined
  let executingWindow: DebounceWindow<This, Arguments, Result> | undefined

  const invoke = (
    window: DebounceWindow<This, Arguments, Result>,
    receiver: This,
    arguments_: Arguments,
  ): Promise<Awaited<Result>> => {
    const previousExecutingWindow = executingWindow
    executingWindow = window
    try {
      const result = callback.apply(receiver, arguments_)
      if (!window.settled && Object.is(result, window.promise)) {
        throw createPromiseCycleError()
      }
      return Promise.resolve(result)
    } catch (error) {
      return Promise.reject(error)
    } finally {
      executingWindow = previousExecutingWindow
    }
  }

  const settleFromInvocation = (
    window: DebounceWindow<This, Arguments, Result>,
    invocation: Promise<Awaited<Result>>,
  ): void => {
    void invocation.then(
      (value) => settleResolved(window, value),
      (reason: unknown) => settleRejected(window, reason),
    )
  }

  const settleFromLeading = (window: DebounceWindow<This, Arguments, Result>): void => {
    if (!window.leadingOutcome) {
      window.finishWithLeading = true
      return
    }

    void window.leadingOutcome.then((outcome) => {
      if (outcome.fulfilled) {
        settleResolved(window, outcome.value)
      } else {
        settleRejected(window, outcome.reason)
      }
    })
  }

  const startLeading = (window: DebounceWindow<This, Arguments, Result>): void => {
    const invocation = invoke(window, window.latestThis, window.latestArguments)

    if (!options.trailing) {
      settleFromInvocation(window, invocation)
      return
    }

    window.leadingOutcome = invocation.then(
      (value): Outcome<Awaited<Result>> => ({ fulfilled: true, value }),
      (reason: unknown): Outcome<Awaited<Result>> => ({ fulfilled: false, reason }),
    )

    if (window.finishWithLeading) {
      settleFromLeading(window)
    }
  }

  const closeWindow = (window: DebounceWindow<This, Arguments, Result>): void => {
    if (activeWindow !== window) {
      return
    }

    activeWindow = undefined
    clearTimers(window)

    if (options.trailing && (!options.leading || window.calls > 1)) {
      settleFromInvocation(window, invoke(window, window.latestThis, window.latestArguments))
    } else if (options.leading && options.trailing) {
      settleFromLeading(window)
    }
  }

  const rescheduleWait = (
    window: DebounceWindow<This, Arguments, Result>,
    delayMs: number,
  ): void => {
    if (window.waitTimer !== undefined) {
      clearTimeout(window.waitTimer)
    }

    window.waitTimer = setTimeout(() => closeWindow(window), delayMs)
  }

  const debounced = function (this: This, ...arguments_: Arguments): Promise<Awaited<Result>> {
    if (executingWindow && activeWindow === executingWindow && !options.trailing) {
      const reentrantWindow = executingWindow
      activeWindow = undefined
      clearTimers(reentrantWindow)
      settleRejected(reentrantWindow, createPromiseCycleError())
      return reentrantWindow.promise
    }

    let delayMs: number

    try {
      delayMs = sampleDelay(options)
    } catch (error) {
      if (activeWindow) {
        const failedWindow = activeWindow
        activeWindow = undefined
        clearTimers(failedWindow)
        settleRejected(failedWindow, error)
        return failedWindow.promise
      }

      return Promise.reject(error)
    }

    if (activeWindow) {
      activeWindow.latestArguments = arguments_
      activeWindow.latestThis = this
      activeWindow.calls += 1
      rescheduleWait(activeWindow, delayMs)
      return activeWindow.promise
    }

    const window = createWindow<This, Arguments, Result>(this, arguments_)
    activeWindow = window

    if (options.maxWait !== undefined) {
      window.maxTimer = setTimeout(() => closeWindow(window), options.maxWait)
    }

    rescheduleWait(window, delayMs)

    if (options.leading) {
      startLeading(window)
    }

    return window.promise
  }

  return Object.assign(debounced, {
    cancel(reason?: unknown): void {
      if (!activeWindow) {
        return
      }

      const cancelledWindow = activeWindow
      activeWindow = undefined
      clearTimers(cancelledWindow)
      settleRejected(cancelledWindow, reason === undefined ? createAbortError() : reason)
    },
    flush(): Promise<Awaited<Result>> | undefined {
      if (!activeWindow) {
        return undefined
      }

      const promise = activeWindow.promise
      closeWindow(activeWindow)
      return promise
    },
    pending(): boolean {
      return activeWindow !== undefined
    },
  })
}

function createWindow<This, Arguments extends unknown[], Result>(
  receiver: This,
  arguments_: Arguments,
): DebounceWindow<This, Arguments, Result> {
  let resolve!: (value: Awaited<Result> | PromiseLike<Awaited<Result>>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Awaited<Result>>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {
    latestArguments: arguments_,
    latestThis: receiver,
    calls: 1,
    settled: false,
    finishWithLeading: false,
    waitTimer: undefined,
    maxTimer: undefined,
    leadingOutcome: undefined,
    promise,
    resolve,
    reject,
  }
}

function settleResolved<This, Arguments extends unknown[], Result>(
  window: DebounceWindow<This, Arguments, Result>,
  value: Awaited<Result>,
): void {
  if (window.settled) {
    return
  }

  window.settled = true
  window.resolve(value)
}

function settleRejected<This, Arguments extends unknown[], Result>(
  window: DebounceWindow<This, Arguments, Result>,
  reason: unknown,
): void {
  if (window.settled) {
    return
  }

  window.settled = true
  window.reject(reason)
}

function clearTimers<This, Arguments extends unknown[], Result>(
  window: DebounceWindow<This, Arguments, Result>,
): void {
  if (window.waitTimer !== undefined) {
    clearTimeout(window.waitTimer)
    window.waitTimer = undefined
  }

  if (window.maxTimer !== undefined) {
    clearTimeout(window.maxTimer)
    window.maxTimer = undefined
  }
}

function sampleDelay(options: NormalizedOptions): number {
  if (typeof options.delay === 'number') {
    return options.delay
  }

  if (options.recordCalls) {
    options.delay.record()
  }

  return validateDuration(options.delay.getDelay(), 'Adaptive delay')
}

function normalizeOptions(
  delayOrOptions: AdaptiveDebounceDelay | AdaptiveDebounceOptions | undefined,
): NormalizedOptions {
  if (typeof delayOrOptions === 'number') {
    return {
      delay: validateDuration(delayOrOptions, 'Delay'),
      recordCalls: false,
      leading: false,
      trailing: true,
      maxWait: undefined,
    }
  }

  if (isAdaptiveDelay(delayOrOptions)) {
    return {
      delay: delayOrOptions,
      recordCalls: true,
      leading: false,
      trailing: true,
      maxWait: undefined,
    }
  }

  if (delayOrOptions !== undefined && !isObject(delayOrOptions)) {
    throw new TypeError('adaptiveDebounce options must be a delay or an options object')
  }

  const suppliedOptions = delayOrOptions ?? {}
  validateBoolean(suppliedOptions.recordCalls, 'recordCalls')
  validateBoolean(suppliedOptions.leading, 'leading')
  validateBoolean(suppliedOptions.trailing, 'trailing')

  const delay =
    suppliedOptions.delay === undefined
      ? createAdaptiveDelay()
      : validateDelay(suppliedOptions.delay)
  const leading = suppliedOptions.leading ?? false
  const trailing = suppliedOptions.trailing ?? true

  if (!leading && !trailing) {
    throw new RangeError('adaptiveDebounce requires leading, trailing, or both')
  }

  return {
    delay,
    recordCalls: suppliedOptions.recordCalls ?? typeof delay !== 'number',
    leading,
    trailing,
    maxWait:
      suppliedOptions.maxWait === undefined
        ? undefined
        : validateDuration(suppliedOptions.maxWait, 'maxWait'),
  }
}

function validateDelay(delay: AdaptiveDebounceDelay): AdaptiveDebounceDelay {
  if (typeof delay === 'number') {
    return validateDuration(delay, 'Delay')
  }

  if (!isAdaptiveDelay(delay)) {
    throw new TypeError('delay must be a non-negative number or an AdaptiveDelay')
  }

  return delay
}

function validateDuration(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number`)
  }

  if (value > MAX_TIMER_DELAY_MS) {
    throw new RangeError(`${name} must be at most ${MAX_TIMER_DELAY_MS} milliseconds`)
  }

  return value
}

function validateBoolean(value: boolean | undefined, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`)
  }
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function isAdaptiveDelay(value: unknown): value is AdaptiveDelay {
  return (
    isObject(value) &&
    'record' in value &&
    typeof value.record === 'function' &&
    'getDelay' in value &&
    typeof value.getDelay === 'function' &&
    'reset' in value &&
    typeof value.reset === 'function' &&
    'subscribe' in value &&
    typeof value.subscribe === 'function' &&
    'exportState' in value &&
    typeof value.exportState === 'function' &&
    'importState' in value &&
    typeof value.importState === 'function'
  )
}

function createAbortError(): Error {
  const error = new Error('The debounced call was cancelled')
  error.name = 'AbortError'
  return error
}

function createPromiseCycleError(): TypeError {
  return new TypeError('Chaining cycle detected for promise')
}
