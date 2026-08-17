import { expect, test } from '@playwright/test'

test('the home page is a ready manual diagnostic', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Test the real WebRTC path between two browsers/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /View on GitHub/ })).toBeVisible()
  await expect(page.locator('#stun-status')).toHaveText(/endpoint/)
  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await expect(page.locator('#manual-process-payload')).toBeDisabled()
  await expect(page.locator('#manual-local-payload')).toBeEmpty()
  await expect(page.locator('#manual-remote-payload')).toBeEmpty()
  await expect(page.locator('#signal-status')).toHaveCount(0)
})

test('reloading the diagnostic starts a clean workflow', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await page.locator('#manual-remote-payload').fill('temporary input')

  await page.reload()

  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await expect(page.locator('#manual-remote-payload')).toBeEmpty()
})
