// @vitest-environment happy-dom

import { createSSRApp, defineComponent, h, nextTick, onMounted } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAdaptiveDebouncePlugin,
  useAdaptiveDebounceRuntime,
  useAdaptiveDelay,
} from '../src/index'

afterEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
})

describe('Vue hydration', () => {
  it('loads persisted timing only after delayed root hydration and starts once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const initialDelays: number[] = []
    const Child = defineComponent({
      setup() {
        const delayMs = useAdaptiveDelay()
        initialDelays.push(delayMs.value)
        return () => h('span', delayMs.value)
      },
    })
    const Root = defineComponent({
      setup() {
        const delayMs = useAdaptiveDelay()
        onMounted(() => expect(delayMs.value).toBe(750))
        return () => h('div', [h(Child), h(Child)])
      },
    })
    localStorage.setItem(
      'adaptive-debounce:state',
      JSON.stringify({ version: 1, smoothedIntervalMs: 200 }),
    )
    const getItem = vi.spyOn(localStorage, 'getItem')
    const server = createSSRApp(Root).use(createAdaptiveDebouncePlugin({ persistence: true }))
    const html = await renderToString(server)
    expect(html).toBe('<div><span>750</span><span>750</span></div>')
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)
    const app = createSSRApp(Root).use(createAdaptiveDebouncePlugin({ persistence: true }))
    const runtime = app.runWithContext(useAdaptiveDebounceRuntime)
    const start = vi.spyOn(runtime, 'start')
    const addListener = vi.spyOn(document, 'addEventListener')
    const removeListener = vi.spyOn(document, 'removeEventListener')

    // Model async router readiness between plugin installation and mount.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(getItem).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    app.mount(container)
    expect(initialDelays).toEqual([750, 750, 750, 750])
    expect(container.textContent).toBe('750750')
    await vi.waitFor(() => expect(runtime.delay.getDelay()).toBe(1_350))
    await nextTick()
    expect(container.textContent).toBe('13501350')
    expect(getItem).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
    expect(addListener).toHaveBeenCalledTimes(4)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    app.unmount()
    expect(removeListener).toHaveBeenCalledTimes(4)
    await expect(runtime.start()).rejects.toThrow('disposed')
    server.runWithContext(useAdaptiveDebounceRuntime).dispose()
  })

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
