import { expectTypeOf } from 'vitest'
import {
  type AdaptiveDebounceDelay,
  type AdaptiveDebounced,
  type AdaptiveDebounceOptions,
  adaptiveDebounce,
} from '../src/adaptive-debounce'
import { type AdaptiveDelay, createAdaptiveDelay } from '../src/adaptive-delay'

interface Context {
  readonly prefix: string
}

interface Result {
  readonly value: string
}

async function callback(this: Context, count: number, label: string): Promise<Result> {
  return { value: `${this.prefix}:${count}:${label}` }
}

const context: Context = { prefix: 'item' }
const debounced = adaptiveDebounce(callback, 100)

expectTypeOf(debounced).toEqualTypeOf<
  AdaptiveDebounced<Context, [count: number, label: string], Promise<Result>>
>()
expectTypeOf(debounced.call(context, 1, 'saved')).toEqualTypeOf<Promise<Result>>()
expectTypeOf(debounced.cancel()).toEqualTypeOf<void>()
expectTypeOf(debounced.cancel(new Error('cancelled'))).toEqualTypeOf<void>()
expectTypeOf(debounced.flush()).toEqualTypeOf<Promise<Result> | undefined>()
expectTypeOf(debounced.pending()).toEqualTypeOf<boolean>()

const mixedResult = adaptiveDebounce((value: number): number | Promise<number> => value, 10)
expectTypeOf(mixedResult(1)).toEqualTypeOf<Promise<number>>()

const delay = createAdaptiveDelay()
expectTypeOf<AdaptiveDebounceDelay>().toEqualTypeOf<number | AdaptiveDelay>()
expectTypeOf<AdaptiveDebounceOptions>().toMatchTypeOf<
  Readonly<{
    delay?: number | AdaptiveDelay
    recordCalls?: boolean
    leading?: boolean
    trailing?: boolean
    maxWait?: number
  }>
>()
adaptiveDebounce(callback, delay)
adaptiveDebounce(callback, { delay, recordCalls: false, leading: true, maxWait: 1_000 })

// @ts-expect-error The callback's arguments are preserved.
debounced.call(context, 'one', 'saved')
// @ts-expect-error The callback's this type is preserved.
debounced.call({ prefix: 1 }, 1, 'saved')
// @ts-expect-error Delay must be numeric or adaptive.
adaptiveDebounce(callback, { delay: 'slow' })
// @ts-expect-error Timing flags are boolean.
adaptiveDebounce(callback, { leading: 'yes' })
// @ts-expect-error maxWait is measured in milliseconds.
adaptiveDebounce(callback, { maxWait: 'soon' })
