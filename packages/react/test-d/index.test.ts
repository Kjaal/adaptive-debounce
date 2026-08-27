import type { AdaptiveDebounced, AdaptiveDelay } from 'adaptive-debounce'
import type { AdaptiveDelayPersistenceAdapter } from 'adaptive-debounce/persistence'
import type { ReactElement, ReactNode } from 'react'
import { expectTypeOf } from 'vitest'
import {
  AdaptiveDebounceProvider,
  type AdaptiveDebounceProviderOptions,
  type AdaptiveDebounceProviderProps,
  type AdaptiveDebounceRuntime,
  useAdaptiveDebouncedCallback,
  useAdaptiveDebounceRuntime,
  useAdaptiveDelay,
} from '../src/index'

interface Context {
  readonly prefix: string
}

interface Result {
  readonly value: string
}

async function callback(this: Context, count: number, label: string): Promise<Result> {
  return { value: `${this.prefix}:${count}:${label}` }
}

function Hooks(): null {
  const runtime = useAdaptiveDebounceRuntime()
  const delayMs = useAdaptiveDelay()
  const debounced = useAdaptiveDebouncedCallback(callback, { maxWait: 2_000 })

  expectTypeOf(runtime).toEqualTypeOf<AdaptiveDebounceRuntime>()
  expectTypeOf(runtime.delay).toEqualTypeOf<AdaptiveDelay>()
  expectTypeOf(runtime.load()).toEqualTypeOf<
    Promise<'imported' | 'invalid' | 'unsupported-version'>
  >()
  expectTypeOf(runtime.flush()).toEqualTypeOf<Promise<void>>()
  expectTypeOf(runtime.clear()).toEqualTypeOf<Promise<void>>()
  expectTypeOf(delayMs).toEqualTypeOf<number>()
  expectTypeOf(debounced).toEqualTypeOf<
    AdaptiveDebounced<Context, [count: number, label: string], Promise<Result>>
  >()

  return null
}

declare const children: ReactNode
declare const adapter: AdaptiveDelayPersistenceAdapter

expectTypeOf(AdaptiveDebounceProvider({ children })).toEqualTypeOf<ReactElement>()
expectTypeOf<AdaptiveDebounceProviderProps>().toMatchTypeOf<
  AdaptiveDebounceProviderOptions & { readonly children?: ReactNode }
>()

AdaptiveDebounceProvider({ children, persistence: true })
AdaptiveDebounceProvider({ children, persistence: { adapter } })
AdaptiveDebounceProvider({ children, observation: false })
AdaptiveDebounceProvider({ children, observation: { root: document.body } })
void Hooks

// @ts-expect-error Observation roots must support DOM element or document events.
AdaptiveDebounceProvider({ observation: { root: new EventTarget() } })
// @ts-expect-error A custom persistence adapter must implement load, save, and clear.
AdaptiveDebounceProvider({ persistence: { adapter: { load: () => undefined } } })
function InvalidOptions(): null {
  // @ts-expect-error Timing controls are boolean.
  useAdaptiveDebouncedCallback(callback, { trailing: 'yes' })
  return null
}

void InvalidOptions
