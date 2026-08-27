import { expectTypeOf } from 'vitest'
import {
  type AdaptiveDelay,
  type AdaptiveDelayImportResult,
  type AdaptiveDelayListener,
  type AdaptiveDelayOptions,
  type AdaptiveDelayStateV1,
  createAdaptiveDelay,
} from '../src/index'

const delay = createAdaptiveDelay({
  minimumDelayMs: 500,
  initialDelayMs: 750,
  maximumDelayMs: 1_500,
  smoothing: 0.25,
  intervalMultiplier: 5,
  quietPeriodMs: 350,
  idleResetMs: 2_000,
  clock: () => 0,
})

expectTypeOf(delay).toEqualTypeOf<AdaptiveDelay>()
expectTypeOf(delay.record()).toEqualTypeOf<void>()
expectTypeOf(delay.getDelay()).toEqualTypeOf<number>()
expectTypeOf(delay.reset()).toEqualTypeOf<void>()
expectTypeOf(delay.subscribe((delayMs) => delayMs)).toEqualTypeOf<() => void>()
expectTypeOf(delay.exportState()).toEqualTypeOf<AdaptiveDelayStateV1>()
expectTypeOf(delay.importState({})).toEqualTypeOf<AdaptiveDelayImportResult>()
expectTypeOf<AdaptiveDelayListener>().toEqualTypeOf<(delayMs: number) => void>()
expectTypeOf<keyof AdaptiveDelayStateV1>().toEqualTypeOf<'version' | 'smoothedIntervalMs'>()
expectTypeOf<AdaptiveDelayStateV1>().toEqualTypeOf<
  Readonly<{ version: 1; smoothedIntervalMs: number | null }>
>()
expectTypeOf<AdaptiveDelayOptions>().toMatchTypeOf<
  Readonly<{
    minimumDelayMs?: number
    initialDelayMs?: number
    maximumDelayMs?: number
    smoothing?: number
    intervalMultiplier?: number
    quietPeriodMs?: number
    idleResetMs?: number
    clock?: () => number
  }>
>()

const state = delay.exportState()
// @ts-expect-error Exported state is readonly.
state.smoothedIntervalMs = 10
// @ts-expect-error Smoothing must be numeric.
createAdaptiveDelay({ smoothing: 'fast' })
// @ts-expect-error record() samples the configured clock and takes no timestamp.
delay.record(100)
