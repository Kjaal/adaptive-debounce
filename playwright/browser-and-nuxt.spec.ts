import { expect, test, type Page } from '@playwright/test'

async function readRecordCount(page: Page): Promise<number> {
  const text = await page.getByTestId('record-count').textContent()
  return Number(text)
}

async function expectRecordDelta(
  page: Page,
  expectedDelta: number,
  action: () => Promise<unknown>,
): Promise<void> {
  const before = await readRecordCount(page)
  await action()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  await expect.poll(() => readRecordCount(page)).toBe(before + expectedDelta)
}

test('server renders deterministic markup, hydrates cleanly, and unmounts observation', async ({
  page,
  request,
}) => {
  const serverResponse = await request.get('/')
  expect(serverResponse.ok()).toBe(true)
  expect(await serverResponse.text()).toContain('server-ready')

  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (/hydration|mismatch/i.test(message.text())) {
      browserErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('client-observing')
  await expectRecordDelta(page, 1, () => page.locator('#text-input').pressSequentially('a'))

  const countBeforeUnmount = await readRecordCount(page)
  await page.getByRole('link', { name: 'Leave observer' }).click()
  await expect(page).toHaveURL(/\/other$/)
  await expect(page.getByRole('heading', { name: 'Observer removed' })).toBeVisible()
  await page.locator('#after-unmount').pressSequentially('a')
  await expect(page.getByTestId('record-count')).toHaveText(String(countBeforeUnmount))
  expect(browserErrors).toEqual([])
})

test('records only trusted eligible browser input and supports dynamic controls', async ({
  context,
  page,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('client-observing')

  await expectRecordDelta(page, 2, () => page.locator('#text-input').pressSequentially('ab'))
  await expectRecordDelta(page, 1, () => page.locator('#textarea-input').pressSequentially('c'))
  await expectRecordDelta(page, 1, () => page.locator('#editable-input').pressSequentially('d'))

  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'dynamic-input'
    document.querySelector('main')?.append(input)
  })
  await expectRecordDelta(page, 1, () => page.locator('#dynamic-input').pressSequentially('e'))

  for (const selector of ['#password-input', '#payment-input', '#otp-input', '#ignored-input']) {
    await expectRecordDelta(page, 0, () => page.locator(selector).pressSequentially('x'))
  }

  const textInput = page.locator('#text-input')
  await expectRecordDelta(page, 0, () => textInput.press('Backspace'))
  await expectRecordDelta(page, 0, () => textInput.press('Control+Z'))
  await expectRecordDelta(page, 0, () =>
    textInput.evaluate((element) => {
      element.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          data: 'synthetic-secret',
          inputType: 'insertText',
        }),
      )
    }),
  )

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('pasted-secret'))
  await textInput.focus()
  await expectRecordDelta(page, 0, () => page.keyboard.press('Control+V'))

  await textInput.focus()
  await expectRecordDelta(page, 1, async () => {
    await page.keyboard.down('a')
    await page.keyboard.down('a')
    await page.keyboard.up('a')
  })

  // Playwright cannot faithfully synthesize trusted autofill or completed IME events.
  // Unit tests cover insertReplacementText filtering and trusted composition completion.
})
