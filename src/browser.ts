import type { AdaptiveDelay } from './adaptive-delay'

const TEXT_INPUT_TYPES = new Set(['email', 'search', 'tel', 'text', 'url'])
const TYPED_INSERTION_TYPES = new Set(['insertLineBreak', 'insertParagraph', 'insertText'])
const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'transaction-amount',
  'transaction-currency',
])
const EDITING_HOST_SELECTOR = 'input, textarea, [contenteditable]'
const OPT_OUT_SELECTOR = '[data-adaptive-debounce-ignore]'

/** Options for {@link observeTyping}. */
export interface ObserveTypingOptions {
  /**
   * Delegated observation root. Omit to use the current document when called.
   *
   * Add `data-adaptive-debounce-ignore` to a control or ancestor to opt out.
   */
  readonly root?: Document | Element
}

function isSensitiveControl(element: Element): boolean {
  const autocomplete = element.getAttribute('autocomplete')?.toLowerCase()
  if (!autocomplete) {
    return false
  }

  return autocomplete
    .split(/\s+/)
    .some((token) => token.startsWith('cc-') || SENSITIVE_AUTOCOMPLETE_TOKENS.has(token))
}

function isEditableHtmlElement(element: Element): element is HTMLElement {
  return 'isContentEditable' in element && element.isContentEditable === true
}

function findEligibleControl(target: EventTarget | null): Element | null {
  if (
    target === null ||
    typeof (target as Partial<Element>).closest !== 'function' ||
    typeof (target as Partial<Element>).getAttribute !== 'function'
  ) {
    return null
  }

  const targetElement = target as Element
  const control = targetElement.closest(EDITING_HOST_SELECTOR)
  if (
    control === null ||
    control.closest(OPT_OUT_SELECTOR) !== null ||
    isSensitiveControl(control)
  ) {
    return null
  }

  if (control.localName === 'input') {
    const inputType = control.getAttribute('type')?.toLowerCase() ?? 'text'
    return TEXT_INPUT_TYPES.has(inputType) ? control : null
  }
  if (control.localName === 'textarea') {
    return control
  }

  return isEditableHtmlElement(control) ? control : null
}

/**
 * Records trusted typed insertions from a delegated browser root.
 *
 * Paste, deletion, autofill, undo, key repeat, synthetic events, and intermediate
 * composition updates are ignored. Password inputs and controls whose autocomplete
 * tokens identify payment, password, or one-time-code data are excluded, as is any
 * control below `data-adaptive-debounce-ignore`. Input values and event data are
 * never read.
 *
 * @example
 * ```ts
 * const stop = observeTyping(delay)
 * // Call during component teardown:
 * stop()
 * ```
 *
 * @throws {Error} When called outside a browser lifecycle.
 */
export function observeTyping(
  delay: AdaptiveDelay,
  options: ObserveTypingOptions = {},
): () => void {
  if (typeof document === 'undefined') {
    throw new Error(
      'observeTyping() requires a browser document; call it during a client lifecycle.',
    )
  }
  if (delay === null || typeof delay !== 'object' || typeof delay.record !== 'function') {
    throw new TypeError('observeTyping() requires an AdaptiveDelay instance.')
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('observeTyping() options must be an object.')
  }

  const root = options.root ?? document
  if (
    typeof root.addEventListener !== 'function' ||
    typeof root.removeEventListener !== 'function'
  ) {
    throw new TypeError('observeTyping() root must support DOM event listeners.')
  }

  let repeatedControl: Element | null = null

  const onKeyDown = (event: Event): void => {
    if (!event.isTrusted) {
      return
    }

    repeatedControl = (event as KeyboardEvent).repeat ? findEligibleControl(event.target) : null
  }

  const onKeyUp = (event: Event): void => {
    if (event.isTrusted && findEligibleControl(event.target) === repeatedControl) {
      repeatedControl = null
    }
  }

  const onBeforeInput = (event: Event): void => {
    if (!event.isTrusted) {
      return
    }

    const inputEvent = event as InputEvent
    const control = findEligibleControl(event.target)
    if (control === null) {
      return
    }
    if (control === repeatedControl) {
      repeatedControl = null
      return
    }
    if (inputEvent.isComposing || !TYPED_INSERTION_TYPES.has(inputEvent.inputType)) {
      return
    }

    delay.record()
  }

  const onCompositionEnd = (event: Event): void => {
    if (event.isTrusted && findEligibleControl(event.target) !== null) {
      delay.record()
    }
  }

  root.addEventListener('keydown', onKeyDown, true)
  root.addEventListener('keyup', onKeyUp, true)
  root.addEventListener('beforeinput', onBeforeInput, true)
  root.addEventListener('compositionend', onCompositionEnd, true)

  let observing = true
  return () => {
    if (!observing) {
      return
    }

    observing = false
    repeatedControl = null
    root.removeEventListener('keydown', onKeyDown, true)
    root.removeEventListener('keyup', onKeyUp, true)
    root.removeEventListener('beforeinput', onBeforeInput, true)
    root.removeEventListener('compositionend', onCompositionEnd, true)
  }
}
