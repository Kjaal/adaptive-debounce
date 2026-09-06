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
  it('uses the approved defaults and preserves the cold recommendation for an 80ms sample', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock })

    expect(delay.getDelay()).toBe(750)
    expect(delay.exportState()).toEqual({
      version: 1,
      smoothedIntervalMs: null,
    })

    delay.record()
    time.set(80)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(80)
    expect(delay.getDelay()).toBe(750)
  })

  it('uses the exact relative-error curve for mature samples', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock })

    expect(delay.importState({ version: 1, smoothedIntervalMs: 100 })).toBe('imported')
    delay.record()
    time.set(200)
    delay.record()

    expect(delay.exportState().smoothedIntervalMs).toBeCloseTo(108.333_333_333_333_33, 12)
    expect(delay.getDelay()).toBeCloseTo(891.666_666_666_666_6, 12)
  })

  it.each([
    [1, 70, 700],
    [400, 100, 850],
  ])(
    'clips extreme first samples %i ms with full gain to %i ms before calculating %i ms',
    (sampleMs, expectedIntervalMs, expectedDelayMs) => {
      const time = createClock()
      const delay = createAdaptiveDelay({ clock: time.clock })

      delay.record()
      time.set(sampleMs)
      delay.record()

      expect(delay.exportState().smoothedIntervalMs).toBe(expectedIntervalMs)
      expect(delay.getDelay()).toBe(expectedDelayMs)
    },
  )

  it('converges monotonically under a sustained 160ms cadence', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock })

    delay.record()
    let previousIntervalMs = 0
    for (let index = 1; index <= 20; index += 1) {
      time.set(index * 160)
      delay.record()
      const currentIntervalMs = delay.exportState().smoothedIntervalMs
      expect(currentIntervalMs).not.toBeNull()
      if (currentIntervalMs === null) {
        throw new Error('A qualifying interval must produce learned state.')
      }
      expect(currentIntervalMs).toBeGreaterThan(previousIntervalMs)
      expect(currentIntervalMs).toBeLessThan(160)
      previousIntervalMs = currentIntervalMs
    }

    expect(previousIntervalMs).toBeGreaterThan(159)
  })

  it('keeps the representative mature trace jump below 100ms', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock })
    const priorIntervalMs = (1_251.946_686_034_500_3 - 350) / 5

    expect(delay.importState({ version: 1, smoothedIntervalMs: priorIntervalMs })).toBe('imported')
    const priorDelayMs = delay.getDelay()
    delay.record()
    time.set(397)
    delay.record()

    expect(delay.getDelay()).toBeCloseTo(1_327.108_909_870_708_4, 10)
    expect(delay.getDelay() - priorDelayMs).toBeCloseTo(75.162_223_836_208_09, 10)
    expect(delay.getDelay() - priorDelayMs).toBeLessThan(100)
  })

  it('clips the first sample even with full smoothing', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({ clock: time.clock, smoothing: 1 })

    delay.record()
    time.set(400)
    delay.record()

    expect(delay.exportState().smoothedIntervalMs).toBe(160)
    expect(delay.getDelay()).toBe(1_150)
  })

  it('derives the cold cadence prior from custom options', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({
      initialDelayMs: 1_000,
      quietPeriodMs: 200,
      intervalMultiplier: 4,
      smoothing: 0.5,
      clock: time.clock,
    })

    expect(delay.getDelay()).toBe(1_000)
    delay.record()
    time.set(100)
    delay.record()

    expect(delay.exportState().smoothedIntervalMs).toBe(150)
    expect(delay.getDelay()).toBe(800)
  })

  it('accepts the former explicit configuration and keeps its state finite', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({
      minimumDelayMs: 100,
      initialDelayMs: 300,
      maximumDelayMs: 1_000,
      intervalMultiplier: 1.25,
      clock: time.clock,
    })

    expect(delay.getDelay()).toBe(300)
    delay.record()
    time.set(100)
    delay.record()

    expect(delay.exportState().smoothedIntervalMs).toBe(85)
    expect(delay.getDelay()).toBe(456.25)
    expect(delay.importState(delay.exportState())).toBe('imported')
    expect(Number.isFinite(delay.getDelay())).toBe(true)
  })

  it('uses the documented 80ms fallback for a zero inverse prior', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({
      minimumDelayMs: 0,
      initialDelayMs: 0,
      maximumDelayMs: 0,
      quietPeriodMs: 0,
      clock: time.clock,
    })

    expect(delay.getDelay()).toBe(0)
    delay.record()
    time.set(1)
    delay.record()

    expect(delay.exportState().smoothedIntervalMs).toBe(70)
    expect(Number.isFinite(delay.getDelay())).toBe(true)
    expect(delay.importState(delay.exportState())).toBe('imported')
    expect(Number.isFinite(delay.getDelay())).toBe(true)
  })

  it.each([
    {
      name: 'overflow',
      initialDelayMs: Number.MAX_VALUE,
      maximumDelayMs: Number.MAX_VALUE,
      intervalMultiplier: 1e-308,
    },
    {
      name: 'underflow',
      initialDelayMs: Number.MIN_VALUE,
      maximumDelayMs: 1,
      intervalMultiplier: Number.MAX_VALUE,
    },
  ])(
    'uses a finite fallback cold prior for $name ratios',
    ({ initialDelayMs, maximumDelayMs, intervalMultiplier }) => {
      const time = createClock()
      const delay = createAdaptiveDelay({
        minimumDelayMs: 0,
        initialDelayMs,
        maximumDelayMs,
        intervalMultiplier,
        quietPeriodMs: 0,
        clock: time.clock,
      })

      delay.record()
      time.set(1)
      delay.record()

      const state = delay.exportState()
      expect(Number.isFinite(state.smoothedIntervalMs)).toBe(true)
      expect(Number.isFinite(delay.getDelay())).toBe(true)
      expect(delay.importState(state)).toBe('imported')
      expect(Number.isFinite(delay.getDelay())).toBe(true)
      expect(Number.isFinite(delay.exportState().smoothedIntervalMs)).toBe(true)
    },
  )

  it.each([Number.MIN_VALUE, Number.MAX_VALUE])(
    'keeps mature curved updates finite from supported state %s',
    (smoothedIntervalMs) => {
      const time = createClock()
      const delay = createAdaptiveDelay({ clock: time.clock })

      expect(delay.importState({ version: 1, smoothedIntervalMs })).toBe('imported')
      delay.record()
      time.set(1)
      delay.record()

      expect(Number.isFinite(delay.exportState().smoothedIntervalMs)).toBe(true)
      expect(Number.isFinite(delay.getDelay())).toBe(true)
    },
  )

  it('clamps recommendations to configured bounds', () => {
    const time = createClock()
    const delay = createAdaptiveDelay({
      minimumDelayMs: 100,
      initialDelayMs: 150,
      maximumDelayMs: 400,
      intervalMultiplier: 2,
      quietPeriodMs: 0,
      smoothing: 1,
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
    expect(delay.getDelay()).toBe(300)
    time.set(1_600)
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
    expect(delay.exportState().smoothedIntervalMs).toBe(85)
  })

  it('starts a new burst after an idle gap without erasing learning', () => {
    const time = createClock()
    const listener = vi.fn()
    const delay = createAdaptiveDelay({ clock: time.clock })
    delay.subscribe(listener)

    delay.record()
    time.set(100)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(85)

    time.set(2_100)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBe(85)
    expect(listener).toHaveBeenCalledTimes(1)

    time.set(2_220)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBeCloseTo(89.798_387_096_774_19, 12)
    expect(listener).toHaveBeenLastCalledWith(798.991_935_483_871)
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

    expect(delay.getDelay()).toBe(750)
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(750)

    time.set(150)
    delay.record()
    expect(delay.exportState().smoothedIntervalMs).toBeNull()
  })

  it('imports only exact version-one privacy-safe state and leaves rejected state untouched', () => {
    const delay = createAdaptiveDelay()
    expect(delay.importState({ version: 1, smoothedIntervalMs: 160 })).toBe('imported')
    expect(delay.getDelay()).toBe(1_150)
    expect(Reflect.ownKeys(delay.exportState())).toEqual(['version', 'smoothedIntervalMs'])

    const time = createClock()
    const importedDelay = createAdaptiveDelay({ clock: time.clock })
    expect(importedDelay.importState({ version: 1, smoothedIntervalMs: 160 })).toBe('imported')
    importedDelay.record()
    time.set(80)
    importedDelay.record()
    expect(importedDelay.exportState().smoothedIntervalMs).toBe(150)

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

    expect(importedDelay.importState({ version: 1, smoothedIntervalMs: null })).toBe('imported')
    expect(importedDelay.exportState().smoothedIntervalMs).toBeNull()
    expect(importedDelay.getDelay()).toBe(750)
    time.set(200)
    importedDelay.record()
    time.set(280)
    importedDelay.record()
    expect(importedDelay.exportState().smoothedIntervalMs).toBe(80)
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
    expect(calls).toEqual(['first', 'second:775', 'third'])
    expect(delay.exportState().smoothedIntervalMs).toBe(85)

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

  it.each(['reset', 'import'] as const)(
    'stops obsolete notifications after a listener performs a reentrant %s',
    (operation) => {
      const time = createClock()
      const delay = createAdaptiveDelay({ clock: time.clock })
      const notifications: number[][] = []
      const expectedDelayMs = operation === 'reset' ? 750 : 1_150
      const removeFirst = delay.subscribe((value) => {
        if (value === 775) {
          if (operation === 'reset') {
            delay.reset()
          } else {
            delay.importState({ version: 1, smoothedIntervalMs: 160 })
          }
        }
      })
      const removeSecond = delay.subscribe((value) => {
        notifications.push([value, delay.getDelay()])
      })

      delay.record()
      time.set(100)
      delay.record()

      expect(notifications).toEqual([[expectedDelayMs, expectedDelayMs]])
      expect(delay.getDelay()).toBe(expectedDelayMs)
      removeFirst()
      removeSecond()
      removeSecond()
      delay.importState({ version: 1, smoothedIntervalMs: 100 })
      expect(notifications).toHaveLength(1)
    },
  )

  it('preserves the first listener error when a later listener resets state', () => {
    const delay = createAdaptiveDelay()
    const firstError = new Error('first')
    const listener = vi.fn()
    delay.subscribe(() => {
      throw firstError
    })
    delay.subscribe((value) => {
      if (value === 850) {
        delay.reset()
      }
    })
    delay.subscribe(listener)

    expect(() => delay.importState({ version: 1, smoothedIntervalMs: 100 })).toThrow(firstError)
    expect(listener).toHaveBeenCalledExactlyOnceWith(750)
    expect(delay.getDelay()).toBe(750)
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
    [{ quietPeriodMs: Number.NaN }, 'quietPeriodMs'],
    [{ quietPeriodMs: -1 }, 'quietPeriodMs'],
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

    expect(delay.exportState().version).toBe(1)
    expect(delay.exportState().smoothedIntervalMs).toBeCloseTo(100, 10)
    expect(Reflect.ownKeys(delay.exportState())).toEqual(['version', 'smoothedIntervalMs'])
  })
})
