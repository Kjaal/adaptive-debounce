// @vitest-environment node

import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AdaptiveDebounceProvider,
  type AdaptiveDebounceProviderProps,
  type AdaptiveDebounceRuntime,
  useAdaptiveDebounceRuntime,
  useAdaptiveDelay,
} from '../src/index'

describe('React server rendering', () => {
  it('renders a deterministic cold snapshot without browser globals', () => {
    function Delay(): ReactElement {
      return createElement('span', null, useAdaptiveDelay())
    }

    const html = renderToString(
      createElement(AdaptiveDebounceProvider, { persistence: true }, createElement(Delay)),
    )

    expect(html).toBe('<span>750</span>')
  })

  it('accepts React reserved key metadata', () => {
    const html = renderToString(
      createElement(
        AdaptiveDebounceProvider,
        { key: 'reset' },
        createElement('span', null, 'ready'),
      ),
    )

    expect(html).toBe('<span>ready</span>')
  })

  it('throws an actionable error outside a Provider', () => {
    function MissingProvider(): null {
      useAdaptiveDebounceRuntime()
      return null
    }

    expect(() => renderToString(createElement(MissingProvider))).toThrow(
      'require an <AdaptiveDebounceProvider>',
    )
  })

  it('isolates separate and nested Providers', () => {
    const captured: AdaptiveDebounceRuntime[] = []

    function Capture(): null {
      captured.push(useAdaptiveDebounceRuntime())
      return null
    }

    renderToString(
      createElement(
        'div',
        null,
        createElement(AdaptiveDebounceProvider, null, createElement(Capture)),
        createElement(
          AdaptiveDebounceProvider,
          null,
          createElement(Capture),
          createElement(AdaptiveDebounceProvider, null, createElement(Capture)),
        ),
      ),
    )

    expect(captured).toHaveLength(3)
    expect(new Set(captured).size).toBe(3)
    expect(new Set(captured.map(({ delay }) => delay)).size).toBe(3)
  })
})

describe('AdaptiveDebounceProvider runtime validation', () => {
  it('rejects invalid option values synchronously', () => {
    const invalidCases: ReadonlyArray<readonly [unknown, string]> = [
      [null, 'props must be a plain object'],
      [{ observation: 'yes' }, 'observation must be a boolean or a plain options object'],
      [{ observation: { root: {} } }, 'observation.root must support DOM event listeners'],
      [{ persistence: 'yes' }, 'persistence must be a boolean or a plain options object'],
      [
        { persistence: { adapter: { load: () => undefined } } },
        'persistence.adapter must provide load, save, and clear methods',
      ],
      [{ onError: 'log' }, 'onError must be a function'],
    ]

    for (const [props, message] of invalidCases) {
      expect(() => callProvider(props)).toThrow(message)
    }
  })

  it('rejects unknown, hidden, symbolic, and inherited configuration', () => {
    const hiddenProps = Object.defineProperty({}, 'hidden', { value: true })
    const symbolicObservation = { [Symbol('unsupported')]: true }
    const hiddenPersistence = Object.defineProperty({}, 'hidden', { value: true })
    const inheritedProps = Object.create({ observation: false })
    const inheritedObservation = Object.create({ root: undefined })
    const inheritedPersistence = Object.create({ adapter: undefined })

    const invalidCases: ReadonlyArray<readonly [unknown, string]> = [
      [{ unsupported: true }, 'props contain unsupported key "unsupported"'],
      [hiddenProps, 'props contain unsupported key "hidden"'],
      [{ observation: symbolicObservation }, 'observation options contain unsupported key'],
      [{ persistence: hiddenPersistence }, 'persistence options contain unsupported key "hidden"'],
      [inheritedProps, 'props must be a plain object'],
      [
        { observation: inheritedObservation },
        'observation must be a boolean or a plain options object',
      ],
      [
        { persistence: inheritedPersistence },
        'persistence must be a boolean or a plain options object',
      ],
      [{ delay: { unsupported: 1 } }, 'delay options contain unsupported key "unsupported"'],
    ]

    for (const [props, message] of invalidCases) {
      expect(() => callProvider(props)).toThrow(message)
    }

    withObjectPrototypeProperty('observation', false, () => {
      expect(() => callProvider({})).toThrow('observation" as an own property')
    })
    withObjectPrototypeProperty('root', null, () => {
      expect(() => callProvider({ observation: {} })).toThrow('root" as an own property')
    })
  })
})

function callProvider(props: unknown): ReactElement {
  return AdaptiveDebounceProvider(props as AdaptiveDebounceProviderProps)
}

function withObjectPrototypeProperty(key: string, value: unknown, assertion: () => void): void {
  const original = Reflect.getOwnPropertyDescriptor(Object.prototype, key)
  Object.defineProperty(Object.prototype, key, { configurable: true, value })
  try {
    assertion()
  } finally {
    if (original) {
      Object.defineProperty(Object.prototype, key, original)
    } else {
      Reflect.deleteProperty(Object.prototype, key)
    }
  }
}
