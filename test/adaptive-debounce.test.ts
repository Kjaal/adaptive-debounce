import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adaptiveDebounce } from '../src/adaptive-debounce'
import { createAdaptiveDelay } from '../src/adaptive-delay'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('adaptiveDebounce', () => {
  it('shares one trailing promise and invokes with the latest arguments and this', async () => {
    const calls: string[] = []
    const debounced = adaptiveDebounce(function (this: { readonly prefix: string }, value: string) {
      const result = `${this.prefix}:${value}`
      calls.push(result)
      return result
    }, 100)

    const first = debounced.call({ prefix: 'old' }, 'first')
    await vi.advanceTimersByTimeAsync(50)
    const second = debounced.call({ prefix: 'new' }, 'last')

    expect(first).toBe(second)
    expect(debounced.pending()).toBe(true)
    await vi.advanceTimersByTimeAsync(99)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)

    await expect(first).resolves.toBe('new:last')
    expect(calls).toEqual(['new:last'])
    expect(debounced.pending()).toBe(false)
  })

  it('uses a private adaptive delay when delay is omitted', async () => {
    const callback = vi.fn(() => 'done')
    const promise = adaptiveDebounce(callback)()

    await vi.advanceTimersByTimeAsync(749)
    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toBe('done')
  })

  it('waits through ordinary continued typing and saves after a sentence-level pause', async () => {
    const cadenceMs = 200
    const continuationPauseMs = 400
    const oldCadenceDelayMs = cadenceMs * 1.25
    const newCadenceDelayMs = cadenceMs * 5 + 350
    let clockTimeMs = 0
    const delay = createAdaptiveDelay({
      clock: () => clockTimeMs,
    })
    const callback = vi.fn((value: string) => value)
    const debounced = adaptiveDebounce(callback, {
      delay,
      recordCalls: false,
    })

    expect(oldCadenceDelayMs).toBeLessThan(continuationPauseMs)
    expect(newCadenceDelayMs).toBeGreaterThan(continuationPauseMs)

    delay.record()
    const first = debounced('first')
    await vi.advanceTimersByTimeAsync(cadenceMs)
    clockTimeMs = cadenceMs
    delay.record()
    const second = debounced('second')
    expect(second).toBe(first)

    await vi.advanceTimersByTimeAsync(continuationPauseMs)
    expect(callback).not.toHaveBeenCalled()
    clockTimeMs = 600
    delay.record()
    expect(delay.getDelay()).toBeCloseTo(891.666_666_666_666_6, 12)
    const third = debounced('third')
    expect(third).toBe(first)
    expect(callback).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(890)
    expect(callback).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2)
    await expect(first).resolves.toBe('third')
    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenLastCalledWith('third')
  })

  it('records and samples shared adaptive delays once per call unless disabled', async () => {
    const delay = createAdaptiveDelay()
    const record = vi.spyOn(delay, 'record')
    const getDelay = vi.spyOn(delay, 'getDelay')
    const debounced = adaptiveDebounce((value: string) => value, delay)

    const first = debounced('first')
    await vi.advanceTimersByTimeAsync(50)
    const second = debounced('second')

    expect(first).toBe(second)
    expect(record).toHaveBeenCalledTimes(2)
    expect(getDelay).toHaveBeenCalledTimes(2)
    await vi.runAllTimersAsync()
    await expect(first).resolves.toBe('second')

    const observedDelay = createAdaptiveDelay()
    const observedRecord = vi.spyOn(observedDelay, 'record')
    const observedGetDelay = vi.spyOn(observedDelay, 'getDelay')
    const observed = adaptiveDebounce(() => 'observed', {
      delay: observedDelay,
      recordCalls: false,
    })

    const observedPromise = observed()
    expect(observed.flush()).toBe(observedPromise)
    await expect(observedPromise).resolves.toBe('observed')
    expect(observedRecord).not.toHaveBeenCalled()
    expect(observedGetDelay).toHaveBeenCalledOnce()
  })

  it('runs only the leading call when trailing is disabled', async () => {
    const callback = vi.fn((value: string) => value)
    const debounced = adaptiveDebounce(callback, {
      delay: 100,
      leading: true,
      trailing: false,
    })

    const first = debounced('first')
    const second = debounced('second')

    expect(first).toBe(second)
    await expect(first).resolves.toBe('first')
    expect(callback).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    expect(debounced.pending()).toBe(false)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('runs a trailing call after leading only when another call joins the window', async () => {
    const callback = vi.fn((value: string) => `${value}:result`)
    const debounced = adaptiveDebounce(callback, {
      delay: 100,
      leading: true,
      trailing: true,
    })

    const single = debounced('single')
    expect(callback).toHaveBeenLastCalledWith('single')
    await vi.advanceTimersByTimeAsync(100)
    await expect(single).resolves.toBe('single:result')
    expect(callback).toHaveBeenCalledOnce()

    const first = debounced('first')
    const second = debounced('second')
    expect(first).toBe(second)
    expect(callback).toHaveBeenLastCalledWith('first')
    await vi.advanceTimersByTimeAsync(100)

    await expect(first).resolves.toBe('second:result')
    expect(callback).toHaveBeenCalledTimes(3)
    expect(callback).toHaveBeenLastCalledWith('second')
  })

  it('settles leading-plus-trailing windows from the final invocation', async () => {
    const resolvers = new Map<string, (value: string) => void>()
    const debounced = adaptiveDebounce(
      (value: string) =>
        new Promise<string>((resolve) => {
          resolvers.set(value, resolve)
        }),
      { delay: 100, leading: true, trailing: true },
    )
    const settled = vi.fn()

    const promise = debounced('leading')
    expect(debounced('trailing')).toBe(promise)
    void promise.then(settled)
    await vi.advanceTimersByTimeAsync(100)

    resolveCall(resolvers, 'leading', 'stale result')
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    resolveCall(resolvers, 'trailing', 'final result')
    await expect(promise).resolves.toBe('final result')
  })

  it('enforces maxWait without letting a rescheduled trailing timer run later', async () => {
    const callback = vi.fn((value: string) => value)
    const debounced = adaptiveDebounce(callback, { delay: 100, maxWait: 250 })

    const promise = debounced('zero')
    await vi.advanceTimersByTimeAsync(80)
    expect(debounced('eighty')).toBe(promise)
    await vi.advanceTimersByTimeAsync(80)
    expect(debounced('one-sixty')).toBe(promise)
    await vi.advanceTimersByTimeAsync(80)
    expect(debounced('two-forty')).toBe(promise)
    await vi.advanceTimersByTimeAsync(10)

    await expect(promise).resolves.toBe('two-forty')
    expect(callback).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('flushes trailing work and cancels with supplied or default reasons', async () => {
    const callback = vi.fn((value: string) => value)
    const debounced = adaptiveDebounce(callback, 100)
    const flushed = debounced('flush')

    expect(debounced.flush()).toBe(flushed)
    expect(debounced.pending()).toBe(false)
    await expect(flushed).resolves.toBe('flush')
    expect(callback).toHaveBeenCalledOnce()
    expect(debounced.flush()).toBeUndefined()

    const reason = new Error('stop')
    const suppliedCancellation = debounced('supplied')
    debounced.cancel(reason)
    await expect(suppliedCancellation).rejects.toBe(reason)

    const defaultCancellation = debounced('default')
    debounced.cancel()
    await expect(defaultCancellation).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()
    expect(callback).toHaveBeenCalledOnce()
  })

  it('turns callback throws and rejections into window rejections', async () => {
    const thrownError = new Error('thrown')
    const thrown = adaptiveDebounce(() => {
      throw thrownError
    }, 10)()
    const thrownAssertion = expect(thrown).rejects.toBe(thrownError)
    await vi.advanceTimersByTimeAsync(10)
    await thrownAssertion

    const rejectedError = new Error('rejected')
    const rejected = adaptiveDebounce(() => Promise.reject(rejectedError), 10)()
    const rejectedAssertion = expect(rejected).rejects.toBe(rejectedError)
    await vi.advanceTimersByTimeAsync(10)
    await rejectedAssertion
  })

  it('keeps reentrant windows independent and ignores stale timers', async () => {
    const calls: string[] = []
    let innerPromise: Promise<string> | undefined
    const debounced = adaptiveDebounce(
      (value: string) => {
        calls.push(value)
        if (value === 'outer') {
          innerPromise = debounced('inner')
        }
        return value
      },
      { delay: 100, maxWait: 150 },
    )

    const outerPromise = debounced('outer')
    await vi.advanceTimersByTimeAsync(100)
    await expect(outerPromise).resolves.toBe('outer')
    expect(calls).toEqual(['outer'])
    expect(innerPromise).toBeDefined()

    await vi.advanceTimersByTimeAsync(50)
    expect(calls).toEqual(['outer'])
    await vi.advanceTimersByTimeAsync(50)
    expect(calls).toEqual(['outer', 'inner'])

    if (!innerPromise) {
      throw new Error('Expected the reentrant call to open a window')
    }
    await expect(innerPromise).resolves.toBe('inner')
  })

  it('rejects a leading-only callback that returns its shared window promise', async () => {
    let invokeAgain = (): Promise<unknown> => Promise.resolve()
    const debounced = adaptiveDebounce(() => invokeAgain(), {
      delay: 100,
      leading: true,
      trailing: false,
    })
    invokeAgain = debounced

    const promise = debounced()

    await expect(promise).rejects.toBeInstanceOf(TypeError)
    expect(debounced.pending()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects async adoption of a reentrant shared window promise', async () => {
    let invokeAgain = (): Promise<unknown> => Promise.resolve()
    const debounced = adaptiveDebounce(async () => invokeAgain(), {
      delay: 100,
      leading: true,
      trailing: false,
    })
    invokeAgain = debounced

    const promise = debounced()

    await expect(promise).rejects.toBeInstanceOf(TypeError)
    expect(debounced.pending()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects the window when a callback ignores its reentrant promise', async () => {
    let invokeAgain = (): Promise<unknown> => Promise.resolve()
    const debounced = adaptiveDebounce(
      () => {
        void invokeAgain()
        return 'ignored'
      },
      { delay: 100, leading: true, trailing: false },
    )
    invokeAgain = debounced

    const promise = debounced()

    await expect(promise).rejects.toBeInstanceOf(TypeError)
    expect(debounced.pending()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('lets leading-plus-trailing reentry join and settle from the trailing call', async () => {
    let invokeAgain = (value: number): Promise<number> => Promise.resolve(value)
    const callback = vi.fn((value: number): number | Promise<number> => {
      if (value === 0) {
        return invokeAgain(1)
      }
      return value
    })
    const debounced = adaptiveDebounce(callback, {
      delay: 100,
      leading: true,
      trailing: true,
    })
    invokeAgain = debounced

    const promise = debounced(0)

    expect(debounced.pending()).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).resolves.toBe(1)
    expect(callback.mock.calls).toEqual([[0], [1]])
    expect(debounced.pending()).toBe(false)
  })

  it('allows maxWait windows to overlap older async work and settle independently', async () => {
    const resolvers = new Map<string, (value: string) => void>()
    const debounced = adaptiveDebounce(
      (value: string) =>
        new Promise<string>((resolve) => {
          resolvers.set(value, resolve)
        }),
      { delay: 1_000, maxWait: 100 },
    )

    const first = debounced('first')
    await vi.advanceTimersByTimeAsync(100)
    const second = debounced('second')
    expect(second).not.toBe(first)
    await vi.advanceTimersByTimeAsync(100)

    resolveCall(resolvers, 'second', 'second result')
    await expect(second).resolves.toBe('second result')
    resolveCall(resolvers, 'first', 'first result')
    await expect(first).resolves.toBe('first result')
  })

  it('rejects invalid timing and invocation options', () => {
    expect(() => adaptiveDebounce(() => undefined, -1)).toThrow('finite, non-negative')
    expect(() => adaptiveDebounce(() => undefined, { leading: false, trailing: false })).toThrow(
      'requires leading, trailing, or both',
    )
    expect(() => adaptiveDebounce(() => undefined, { maxWait: Number.POSITIVE_INFINITY })).toThrow(
      'finite, non-negative',
    )
  })
})

function resolveCall(
  resolvers: ReadonlyMap<string, (value: string) => void>,
  call: string,
  value: string,
): void {
  const resolve = resolvers.get(call)
  if (!resolve) {
    throw new Error(`Missing resolver for ${call}`)
  }
  resolve(value)
}
