import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdaptiveDelay } from '../src/adaptive-delay'
import { observeTyping } from '../src/browser'

class FakeRoot {
  readonly root = this as unknown as Document
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null) {
      return
    }

    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null) {
      return
    }

    const listeners = this.listeners.get(type)
    listeners?.delete(listener)
    if (listeners?.size === 0) {
      this.listeners.delete(type)
    }
  }

  emit(type: string, event: Readonly<Record<string, unknown>>): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === 'function') {
        listener(event as unknown as Event)
      } else {
        listener.handleEvent(event as unknown as Event)
      }
    }
  }
}

interface FakeControlOptions {
  readonly localName?: string
  readonly type?: string
  readonly autocomplete?: string
  readonly contentEditable?: boolean
  readonly optedOut?: boolean
}

function createControl(options: FakeControlOptions = {}): Element {
  const {
    localName = 'input',
    type,
    autocomplete,
    contentEditable = false,
    optedOut = false,
  } = options
  const attributes = new Map<string, string>()
  if (type !== undefined) {
    attributes.set('type', type)
  }
  if (autocomplete !== undefined) {
    attributes.set('autocomplete', autocomplete)
  }
  if (contentEditable) {
    attributes.set('contenteditable', '')
  }

  let element: Element
  element = {
    localName,
    isContentEditable: contentEditable,
    get value(): never {
      throw new Error('input values must not be read')
    },
    getAttribute(name: string): string | null {
      return attributes.get(name) ?? null
    },
    closest(selector: string): Element | null {
      if (selector === 'input, textarea, [contenteditable]') {
        return element
      }
      if (selector === '[data-adaptive-debounce-ignore]') {
        return optedOut ? element : null
      }
      throw new Error(`Unexpected selector: ${selector}`)
    },
  } as unknown as Element

  return element
}

function createEvent(
  target: Element,
  properties: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    isTrusted: true,
    target,
    ...properties,
    get data(): never {
      throw new Error('event data must not be read')
    },
  }
}

function createDelaySpy(): {
  readonly delay: AdaptiveDelay
  readonly record: ReturnType<typeof vi.fn>
} {
  const record = vi.fn()
  return {
    delay: { record } as unknown as AdaptiveDelay,
    record,
  }
}

function startObserver(root = new FakeRoot()): {
  readonly root: FakeRoot
  readonly record: ReturnType<typeof vi.fn>
  readonly stop: () => void
} {
  vi.stubGlobal('document', {})
  const { delay, record } = createDelaySpy()
  return { root, record, stop: observeTyping(delay, { root: root.root }) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('observeTyping', () => {
  it('is safe to import without DOM globals and throws clearly when called on the server', () => {
    expect(typeof observeTyping).toBe('function')
    vi.stubGlobal('document', undefined)

    expect(() => observeTyping(createDelaySpy().delay)).toThrow('requires a browser document')
  })

  it('resolves the current document only when called', () => {
    const root = new FakeRoot()
    vi.stubGlobal('document', root.root)

    const stop = observeTyping(createDelaySpy().delay)
    expect(root.listeners.size).toBe(4)
    stop()
  })

  it('records trusted typed insertions from dynamic text controls and editable roots', () => {
    const { root, record } = startObserver()

    root.emit('beforeinput', createEvent(createControl(), { inputType: 'insertText' }))
    root.emit(
      'beforeinput',
      createEvent(createControl({ localName: 'textarea' }), {
        inputType: 'insertLineBreak',
      }),
    )
    root.emit(
      'beforeinput',
      createEvent(createControl({ localName: 'div', contentEditable: true }), {
        inputType: 'insertParagraph',
      }),
    )

    const dynamicallyAddedInput = createControl({ type: 'search' })
    root.emit('beforeinput', createEvent(dynamicallyAddedInput, { inputType: 'insertText' }))

    expect(record).toHaveBeenCalledTimes(4)
  })

  it('ignores synthetic, non-typed, autofill, and intermediate composition input', () => {
    const { root, record } = startObserver()
    const input = createControl()
    const ignoredInputTypes = [
      'deleteContentBackward',
      'deleteByCut',
      'historyRedo',
      'historyUndo',
      'insertCompositionText',
      'insertFromDrop',
      'insertFromPaste',
      'insertFromPasteAsQuotation',
      'insertFromYank',
      'insertReplacementText',
    ]

    for (const inputType of ignoredInputTypes) {
      root.emit('beforeinput', createEvent(input, { inputType }))
    }
    root.emit('beforeinput', createEvent(input, { inputType: 'insertText', isComposing: true }))
    root.emit('beforeinput', createEvent(input, { inputType: 'insertText', isTrusted: false }))
    root.emit('input', createEvent(input, { inputType: 'insertText' }))
    root.emit('keydown', createEvent(input, { key: 'ArrowLeft', repeat: false }))

    expect(record).not.toHaveBeenCalled()
  })

  it('ignores repeated keys without blocking the next ordinary key', () => {
    const { root, record } = startObserver()
    const input = createControl()

    root.emit('keydown', createEvent(input, { key: 'a', repeat: true }))
    root.emit('beforeinput', createEvent(input, { inputType: 'insertText' }))
    root.emit('keydown', createEvent(input, { key: 'a', repeat: true }))
    root.emit('beforeinput', createEvent(input, { inputType: 'insertText' }))
    expect(record).not.toHaveBeenCalled()

    root.emit('keydown', createEvent(input, { key: 'b', repeat: false }))
    root.emit('beforeinput', createEvent(input, { inputType: 'insertText' }))
    expect(record).toHaveBeenCalledOnce()
  })

  it('records a completed composition once', () => {
    const { root, record } = startObserver()
    const input = createControl()

    root.emit(
      'beforeinput',
      createEvent(input, { inputType: 'insertCompositionText', isComposing: true }),
    )
    root.emit(
      'beforeinput',
      createEvent(input, { inputType: 'insertCompositionText', isComposing: true }),
    )
    root.emit('compositionend', createEvent(input))
    root.emit('compositionend', createEvent(input, { isTrusted: false }))

    expect(record).toHaveBeenCalledOnce()
  })

  it('excludes sensitive and explicitly opted-out controls', () => {
    const { root, record } = startObserver()
    const excludedControls = [
      createControl({ type: 'password' }),
      createControl({ autocomplete: 'current-password' }),
      createControl({ autocomplete: 'one-time-code' }),
      createControl({ autocomplete: 'section-checkout cc-number' }),
      createControl({ autocomplete: 'transaction-amount' }),
      createControl({ optedOut: true }),
    ]

    for (const control of excludedControls) {
      root.emit('beforeinput', createEvent(control, { inputType: 'insertText' }))
      root.emit('compositionend', createEvent(control))
    }

    expect(record).not.toHaveBeenCalled()
  })

  it('does not read input values or event data', () => {
    const { root, record } = startObserver()
    root.emit('beforeinput', createEvent(createControl(), { inputType: 'insertText' }))

    expect(record).toHaveBeenCalledOnce()
  })

  it('removes every delegated listener with idempotent teardown', () => {
    const { root, record, stop } = startObserver()
    const input = createControl()

    expect(root.listeners.size).toBe(4)
    stop()
    stop()
    expect(root.listeners.size).toBe(0)

    root.emit('beforeinput', createEvent(input, { inputType: 'insertText' }))
    root.emit('compositionend', createEvent(input))
    expect(record).not.toHaveBeenCalled()
  })
})
