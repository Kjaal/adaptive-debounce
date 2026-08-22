import { describe, expect, it, vi } from 'vitest'
import { createAdaptiveDelay } from '../src/adaptive-delay'

function createClock(start = 0): {
  readonly clock: () => number
  set(timeMs: number): void
} {
  let timeMs = start
  return {
    clock: () => timeMs,
    set(nextTimeMs) {
      timeMs = nextTimeMs
    },
  }
}

describe('createAdaptiveDelay', () => {
  it('uses the approved defaults and clipped EWMA arithmetic', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock })

    expect(delay.getDelay()).toBe(300)
    expect(delay.exportState()).toEqual({
      version: 1,
      smoothedIntervalMs: null,
    })

    delay.record()
    time.set(200)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(200)
    expect(delay.getDelay()).toBe(250)

    time.set(1_000)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(250)
    expect(delay.getDelay()).toBe(312.5)

    time.set(1_010)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(218.75)
    expect(delay.getDelay()).toBe(273.4375)
  })

  it('clamps recommendations to configured bounds', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({
      minimumDelayMs: 100,
      initialDelayMs: 150,
      maximumDelayMs: 400,
      intervalMultiplier: 2,
      clock: time.clock,
    })

    delay.record()
    time.set(25)
    delay.record()
    expect(delay.getDelay()).toBe(100)

    delay.reset()
    time.set(1_000)
    delay.record()
    time.set(1_300)
    delay.record()
    expect(delay.getDelay()).toBe(400)
  })

  it('ignores equal timestamps and rejects regressing or non-finite clocks atomically', () => {
    const time = createClock(100)
    const delay = createAdaptiveDelay({ clock: time.clock })

    delay.record()
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBeNull()

    time.set(90)
    expect(() => delay.record()).toThrow('clock must not move backwards')
    expect(delay.exportState().smoothedIntervalMs).toBeNull()

    for (const nonFiniteTime of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      time.set(nonFiniteTime)
      expect(() => delay.record()).toThrow('clock must return a finite number')
      expect(delay.exportState().smoothedIntervalMs).toBeNull()
    }

    time.set(200)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(100)
  })

  it('starts a new burst after an idle gap without erasing learning', () => {
    const time = createClock()
    const listener = vi.fn()
    const delay = createAdaptiveDelay({ clock: time.clock })
    delay.subscribe(listener)

    delay.record()
    time.set(100)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(100)

    time.set(2_100)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(100)
    expect(listener).toHaveBeenCalledTimes(1)

    time.set(2_220)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(105)
    expect(listener).toHaveBeenLastCalledWith(131.25)
  })

  it('resets learning and the burst baseline', () => {
    const time = createClock()
    const listener = vi.fn()
    const delay = createAdaptiveDelay({ clock: time.clock })
    delay.subscribe(listener)

    delay.record()
    time.set(100)
    delay.record()
    delay.reset()

    expect(delay.getDelay()).toBe(300)
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(300)

    time.set(150)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
  })

  it('imports only exact version-one privacy-safe state and leaves rejected state untouched', () => {
    const delay = createAdaptiveDelay()
    expect(delay.importState({ version: 1, smoothedIntervalMs: 160 })).toBe('imported')
    expect(delay.getDelay()).toBe(200)
    expect(Reflect.ownKeys(delay.exportState())).toEqual(['version', 'smoothedIntervalMs'])

    const invalidStates: readonly unknown[] = [
      null,
      {},
      { version: '1', smoothedIntervalMs: 100 },
      { version: 1 },
      { version: 1, smoothedIntervalMs: 0 },
      { version: 1, smoothedIntervalMs: -1 },
      { version: 1, smoothedIntervalMs: Number.POSITIVE_INFINITY },
      { version: 1, smoothedIntervalMs: 100, timestamp: 123 },
      Object.defineProperty({}, 'version', {
        get() {
          throw new Error('untrusted getter')
        },
      }),
    ]

    for (const state of invalidStates) {
      expect(delay.importState(state)).toBe('invalid')
      expect(delay.exportState()).toEqual({
        version: 1,
        smoothedIntervalMs: 160,
      })
    }

    expect(delay.importState({ version: 2, anything: true })).toBe('unsupported-version')
    expect(delay.exportState().smoothedIntervalMs).toBe(160)

    expect(delay.importState({ version: 1, smoothedIntervalMs: null })).toBe('imported')
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
  })

  it('notifies listeners synchronously in order, runs all of them after errors, and keeps state committed', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock })
    const firstError = new Error('first')
    const calls: string[] = []

    const removeFirst = delay.subscribe(() => {
      calls.push('first')
      throw firstError
    })
    const removeSecond = delay.subscribe((delayMs) => {
      calls.push(`second:${delayMs}`)
    })
    const removeThird = delay.subscribe(() => {
      calls.push('third')
      throw new Error('third')
    })

    expect(calls).toEqual([])
    delay.record()
    time.set(100)
    expect(() => delay.record()).toThrow(firstError)
    expect(calls).toEqual(['first', 'second:125', 'third'])
    expect(delay.exportState().smoothedIntervalMs).toBe(100)

    removeFirst()
    removeFirst()
    removeSecond()
    removeSecond()
    removeThird()
    removeThird()

    time.set(200)
    expect(() => delay.record()).not.toThrow()
    expect(calls).toHaveLength(3)
  })

  it('does not notify when an accepted operation leaves exported state unchanged', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock })
    const listener = vi.fn()
    delay.subscribe(listener)

    delay.reset()
    expect(delay.importState({ version: 1, smoothedIntervalMs: null })).toBe('imported')
    delay.record()
    delay.record()

    expect(listener).not.toHaveBeenCalled()
  })

  it.each([
    [{ minimumDelayMs: -1 }, 'minimumDelayMs'],
    [{ initialDelayMs: Number.NaN }, 'initialDelayMs'],
    [{ maximumDelayMs: 99 }, 'maximumDelayMs'],
    [{ minimumDelayMs: 500, maximumDelayMs: 400 }, 'maximumDelayMs'],
    [{ smoothing: 0 }, 'smoothing'],
    [{ smoothing: 1.1 }, 'smoothing'],
    [{ intervalMultiplier: 0 }, 'intervalMultiplier'],
    [{ idleResetMs: 0 }, 'idleResetMs'],
  ] as const)('rejects invalid options %o', (options, expectedMessage) => {
    expect(() => createAdaptiveDelay(options)).toThrow(expectedMessage)
  })

  it('retains only constant-size exportable state during long sessions', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock })

    for (let index = 0; index < 10_000; index += 1) {
      time.set(index * 100)
      delay.record()
    }

    expect(delay.exportState()).toEqual({
      version: 1,
      smoothedIntervalMs: 100,
    })
    expect(Reflect.ownKeys(delay.exportState())).toEqual(['version', 'smoothedIntervalMs'])
  })
})
