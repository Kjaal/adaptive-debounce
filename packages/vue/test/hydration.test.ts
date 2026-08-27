// @vitest-environment happy-dom

import { createSSRApp, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdaptiveDebouncePlugin, useAdaptiveDelay } from '../src/index'

afterEach(() => {
  document.body.replaceChildren()
})

describe('Vue hydration', () => {
  it('hydrates the deterministic cold state without mismatch warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = createSSRApp({
      setup() {
        const delayMs = useAdaptiveDelay()
        return () => h('span', Math.round(delayMs.value))
      },
    })
    app.use(createAdaptiveDebouncePlugin({ autoStart: false, observe: false }))

    const container = document.createElement('div')
    container.innerHTML = '<span>750</span>'
    document.body.append(container)
    app.mount(container)

    expect(container.textContent).toBe('750')
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()

    app.unmount()
  })
})
