import { expect, test } from '@playwright/test'

test('the overview leads into a ready manual diagnostic', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Debug ICE, STUN & WebRTC/ })).toBeVisible()
  await page.getByRole('link', { name: 'Open diagnostic' }).click()

  await expect(page).toHaveURL(/\/manual\/?$/u)
  await expect(page.locator('#stun-status')).toHaveText(/endpoint/)
  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await expect(page.locator('#manual-process-payload')).toBeDisabled()
  await expect(page.locator('#manual-local-payload')).toBeEmpty()
  await expect(page.locator('#manual-remote-payload')).toBeEmpty()
  await expect(page.locator('#signal-status')).toHaveCount(0)
})

test('returning to the overview and reopening starts a clean workflow', async ({ page }) => {
  await page.goto('/manual')
  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await page.locator('#manual-remote-payload').fill('temporary input')

  await page.getByRole('link', { name: 'Overview' }).click()
  await page.getByRole('link', { name: 'Open diagnostic' }).click()

  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await expect(page.locator('#manual-remote-payload')).toBeEmpty()
})
