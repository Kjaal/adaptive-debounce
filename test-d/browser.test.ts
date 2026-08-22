import { expectTypeOf } from 'vitest'
import type { AdaptiveDelay } from '../src/adaptive-delay'
import { type ObserveTypingOptions, observeTyping } from '../src/browser'

declare const delay: AdaptiveDelay

expectTypeOf(observeTyping(delay)).toEqualTypeOf<() => void>()
expectTypeOf(observeTyping(delay, { root: document })).toEqualTypeOf<() => void>()
expectTypeOf(observeTyping(delay, { root: document.body })).toEqualTypeOf<() => void>()
expectTypeOf<ObserveTypingOptions>().toEqualTypeOf<Readonly<{ root?: Document | Element }>>()

// @ts-expect-error The delegated root must be a document or element.
observeTyping(delay, { root: new EventTarget() })
