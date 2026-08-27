import type { AdaptiveDelayPersistenceAdapter } from 'adaptive-debounce/persistence'
import type { ShallowRef } from 'vue'
import {
  createAdaptiveDebouncePlugin,
  type AdaptiveDebounceRuntime,
  useAdaptiveDebouncedFn,
  useAdaptiveDebounceRuntime,
  useAdaptiveDelay,
} from '../src/index'

interface Editor {
  readonly prefix: string
}

const plugin = createAdaptiveDebouncePlugin({
  delay: { initialDelayMs: 900 },
  observe: false,
  persistence: true,
})
void plugin

const adapter: AdaptiveDelayPersistenceAdapter = {
  load: () => undefined,
  save: () => undefined,
  clear: () => undefined,
}
createAdaptiveDebouncePlugin({ persistence: { adapter, autosave: false } })

const runtime: AdaptiveDebounceRuntime = useAdaptiveDebounceRuntime()
void runtime.start()
runtime.stop()
runtime.dispose()

const delay: Readonly<ShallowRef<number>> = useAdaptiveDelay()
// @ts-expect-error the delay ref is readonly
delay.value = 100

const save = useAdaptiveDebouncedFn(function (this: Editor, value: number) {
  return Promise.resolve(`${this.prefix}${value}`)
})
const result: Promise<string> = save.call({ prefix: '#' }, 1)
void result
save.cancel()
void save.flush()
void save.pending()

// @ts-expect-error callback arguments remain strongly typed
void save.call({ prefix: '#' }, '1')
// @ts-expect-error the shared app delay cannot be overridden per composable
useAdaptiveDebouncedFn(() => undefined, { delay: 100 })
// @ts-expect-error wrapper calls cannot train the shared learner
useAdaptiveDebouncedFn(() => undefined, { recordCalls: true })
