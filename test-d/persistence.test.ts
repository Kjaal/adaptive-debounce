import { expectTypeOf } from 'vitest'
import { createAdaptiveDelay } from '../src/adaptive-delay'
import {
  type AdaptiveDelayAutosaveOptions,
  type AdaptiveDelayPersistence,
  type AdaptiveDelayPersistenceAdapter,
  type AdaptiveDelayPersistenceOptions,
  createAdaptiveDelayPersistence,
} from '../src/persistence'
import type { AdaptiveDelayImportResult, AdaptiveDelayStateV1 } from '../src/adaptive-delay'

const delay = createAdaptiveDelay()
const syncAdapter: AdaptiveDelayPersistenceAdapter = {
  load: () => ({ version: 1, smoothedIntervalMs: 100 }),
  save: (state) => {
    expectTypeOf(state).toEqualTypeOf<AdaptiveDelayStateV1>()
  },
  clear: () => undefined,
}
const asyncAdapter: AdaptiveDelayPersistenceAdapter = {
  load: async (): Promise<unknown> => ({ version: 1, smoothedIntervalMs: 100 }),
  save: async () => undefined,
  clear: async () => undefined,
}

const persistence = createAdaptiveDelayPersistence(delay, syncAdapter)
const autosaving = createAdaptiveDelayPersistence(delay, asyncAdapter, {
  autosave: { onError: (error) => expectTypeOf(error).toEqualTypeOf<unknown>() },
})

expectTypeOf(persistence).toEqualTypeOf<AdaptiveDelayPersistence>()
expectTypeOf(persistence.load()).toEqualTypeOf<Promise<AdaptiveDelayImportResult>>()
expectTypeOf(persistence.save()).toEqualTypeOf<Promise<void>>()
expectTypeOf(persistence.flush()).toEqualTypeOf<Promise<void>>()
expectTypeOf(persistence.clear()).toEqualTypeOf<Promise<void>>()
expectTypeOf(persistence.dispose()).toEqualTypeOf<void>()
expectTypeOf(autosaving).toEqualTypeOf<AdaptiveDelayPersistence>()
expectTypeOf<AdaptiveDelayAutosaveOptions>().toEqualTypeOf<
  Readonly<{ onError: (error: unknown) => void }>
>()
expectTypeOf<AdaptiveDelayPersistenceOptions>().toEqualTypeOf<
  Readonly<{ autosave?: AdaptiveDelayAutosaveOptions }>
>()

// @ts-expect-error Autosave always requires an error callback.
createAdaptiveDelayPersistence(delay, syncAdapter, { autosave: {} })
// @ts-expect-error Adapter writes receive only version-one adaptive state.
syncAdapter.save({ version: 1, smoothedIntervalMs: 'fast' })
