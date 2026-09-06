import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'

const development = process.env.FRAMEWORK_HMR === '1'

interface ObservationProbe {
  active: number
  added: number
  removed: number
  documentId: string
}

async function probe(page: Page): Promise<ObservationProbe> {
  return page.evaluate(() => Reflect.get(window, '__adaptiveObservation') as ObservationProbe)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Set<EventListenerOrEventListenerObject>()
    const state = { active: 0, added: 0, removed: 0, documentId: crypto.randomUUID() }
    Reflect.set(window, '__adaptiveObservation', state)
    const add = document.addEventListener.bind(document)
    const remove = document.removeEventListener.bind(document)
    document.addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'beforeinput' && listener && !listeners.has(listener)) {
        listeners.add(listener)
        state.added += 1
        state.active = listeners.size
      }
      add(type, listener, options)
    }
    document.removeEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === 'beforeinput' && listener && listeners.delete(listener)) {
        state.removed += 1
        state.active = listeners.size
      }
      remove(type, listener, options)
    }
  })
})

test('hydrates, preserves one observer across navigation, and cleans up on unmount', async ({
  page,
  request,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration|mismatch/i.test(message.text()))
      errors.push(message.text())
  })
  const response = await request.get('/')
  expect(response.ok()).toBe(true)
  expect(await response.text()).toContain('data-testid="delay">750</span>')
  await page.goto('/')
  await expect(page.getByTestId('mounted')).toHaveText('true')
  await expect.poll(async () => (await probe(page)).active).toBe(1)
  const initial = await probe(page)
  await page.locator('#typing-sample').pressSequentially('ab', { delay: 100 })
  await expect(page.getByTestId('delay')).not.toHaveText('750')
  const learnedDelay = await page.getByTestId('delay').textContent()
  await page.getByRole('link', { name: 'Other page' }).click()
  await expect(page).toHaveURL(/\/other$/)
  await expect(page.getByTestId('delay')).toHaveText(learnedDelay ?? '')
  expect(await probe(page)).toEqual(initial)
  await page.getByRole('button', { name: 'Unmount app' }).click()
  await expect.poll(async () => (await probe(page)).active).toBe(0)
  expect((await probe(page)).removed).toBe(initial.added)
  expect(errors).toEqual([])
})

test('restores a saved profile only after hydrating the cold state', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      'adaptive-debounce:state',
      JSON.stringify({ version: 1, smoothedIntervalMs: 200 }),
    )
    const reads = { count: 0, beforeMounted: false, delayAtRead: '' }
    Reflect.set(window, '__adaptiveStorageReads', reads)
    const getItem = Storage.prototype.getItem
    Storage.prototype.getItem = function (key: string): string | null {
      if (this === localStorage && key === 'adaptive-debounce:state') {
        reads.count += 1
        reads.beforeMounted ||= document.documentElement.dataset.frameworkMounted !== 'true'
        reads.delayAtRead = document.querySelector('[data-testid="delay"]')?.textContent ?? ''
      }
      return getItem.call(this, key)
    }
  })
  const response = await request.get('/')
  expect(response.ok()).toBe(true)
  expect(await response.text()).toContain('data-testid="delay">750</span>')
  await page.goto('/')
  await expect(page.getByTestId('mounted-delay')).toHaveText('750')
  await expect(page.getByTestId('delay')).toHaveText('1350')
  expect(await page.evaluate(() => Reflect.get(window, '__adaptiveStorageReads'))).toEqual({
    count: 1,
    beforeMounted: false,
    delayAtRead: '750',
  })
  await expect.poll(async () => (await probe(page)).active).toBe(1)
  await page.getByRole('button', { name: 'Unmount app' }).click()
  await expect.poll(async () => (await probe(page)).active).toBe(0)
  expect(errors).toEqual([])
})

test('component HMR retains one runtime and plugin reload restores one active runtime', async ({
  page,
}) => {
  test.skip(!development, 'Requires the isolated development server.')
  const appPath = fileURLToPath(new URL('../test/fixtures/nuxt/app/app.vue', import.meta.url))
  const pluginPath = fileURLToPath(new URL('../dist/runtime/plugin.js', import.meta.url))
  const appSource = await readFile(appPath, 'utf8')
  const pluginSource = await readFile(pluginPath, 'utf8')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto('/')
    await expect(page.getByTestId('mounted')).toHaveText('true')
    await expect.poll(async () => (await probe(page)).active).toBe(1)
    const initial = await probe(page)
    await writeFile(
      appPath,
      appSource.replace("const revision = 'initial'", "const revision = 'updated'"),
    )
    await expect(page.getByTestId('revision')).toHaveText('updated')
    // A reset counter from a full reload cannot pass the component HMR check.
    expect(await probe(page)).toEqual(initial)
    const reloaded = page.waitForEvent('domcontentloaded')
    await writeFile(pluginPath, `${pluginSource}\n// Lifecycle reload probe.\n`)
    await reloaded
    await expect(page.getByTestId('mounted')).toHaveText('true')
    await expect.poll(async () => (await probe(page)).active).toBe(1)
    expect((await probe(page)).documentId).not.toBe(initial.documentId)
    // Plugin changes fully replace the document; explicit unmount separately proves cleanup.
    await page.getByRole('button', { name: 'Unmount app' }).click()
    await expect.poll(async () => (await probe(page)).active).toBe(0)
    expect((await probe(page)).removed).toBe((await probe(page)).added)
    expect(errors).toEqual([])
  } finally {
    await writeFile(appPath, appSource)
    await writeFile(pluginPath, pluginSource)
  }
})
