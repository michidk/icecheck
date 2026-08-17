import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('the home page is a ready manual diagnostic', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Find where a peer connection fails/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /GitHub/ })).toBeVisible()
  await expect(page.locator('#stun-status')).toHaveText(/endpoint/)
  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await expect(page.locator('#manual-process-payload')).toBeDisabled()
  await expect(page.locator('#manual-local-payload')).toBeEmpty()
  await expect(page.locator('#manual-remote-payload')).toBeEmpty()
  await expect(page.locator('#manual-verdict-title')).toHaveText('No connection tested yet')
  await expect(page.locator('#manual-workflow-label')).toHaveText('Ready')
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

test('configuration failure disables STUN without blocking LAN-only diagnostics', async ({ page }) => {
  await page.route('**/config', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'unavailable' }),
  }))

  await page.goto('/')

  await expect(page.locator('#stun-status')).toHaveText('unavailable')
  await expect(page.locator('#manual-stun-option')).toBeDisabled()
  await expect(page.locator('#manual-strategy')).toHaveValue('lan')
  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('HTTP 503')
})

test('invalid payload errors remain visible beside the workflow', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#manual-create-offer')).toBeEnabled()

  await page.locator('#manual-remote-payload').fill('not+base64url')
  await page.locator('#manual-process-payload').click()

  await expect(page.getByRole('alert')).toContainText('not valid base64url')
  await expect(page.locator('#manual-workflow-label')).toHaveText('Action needed')
})

test('native sharing sends the generated payload without a signaling service', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ text }: ShareData) => {
        Object.defineProperty(window, '__sharedPayload', { configurable: true, value: text })
      },
    })
  })
  await page.goto('/')
  await expect(page.locator('#manual-create-offer')).toBeEnabled()
  await page.locator('#manual-strategy').selectOption('lan')
  await page.locator('#manual-create-offer').click()
  await expect(page.locator('#manual-local-payload')).toHaveValue(/.+/, { timeout: 20_000 })

  await expect(page.locator('#manual-share-payload')).toBeVisible()
  await page.locator('#manual-share-payload').click()
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __sharedPayload?: string }
  ).__sharedPayload)).toBe(await page.locator('#manual-local-payload').inputValue())
})

test('two pages complete and reset a direct manual WebRTC diagnostic', async ({ browser }) => {
  test.setTimeout(60_000)
  const offererContext = await browser.newContext()
  const answererContext = await browser.newContext()
  const offerer = await offererContext.newPage()
  const answerer = await answererContext.newPage()
  await Promise.all([trackPeerConnections(offerer), trackPeerConnections(answerer)])
  await Promise.all([offerer.goto('/'), answerer.goto('/')])
  await Promise.all([
    expect(offerer.locator('#manual-create-offer')).toBeEnabled(),
    expect(answerer.locator('#manual-create-offer')).toBeEnabled(),
  ])

  await offerer.locator('#manual-strategy').selectOption('lan')
  await offerer.locator('#manual-create-offer').click()
  const offerPayload = offerer.locator('#manual-local-payload')
  await expect(offerPayload).toHaveValue(/.+/, { timeout: 20_000 })

  await answerer.locator('#manual-remote-payload').fill(await offerPayload.inputValue())
  await answerer.locator('#manual-process-payload').click()
  const answerPayload = answerer.locator('#manual-local-payload')
  await expect(answerPayload).toHaveValue(/.+/, { timeout: 20_000 })

  await offerer.locator('#manual-remote-payload').fill(await answerPayload.inputValue())
  await offerer.locator('#manual-process-payload').click()

  await Promise.all([
    expect(offerer.locator('#manual-verdict')).toHaveAttribute('data-tone', 'success', { timeout: 20_000 }),
    expect(answerer.locator('#manual-verdict')).toHaveAttribute('data-tone', 'success', { timeout: 20_000 }),
  ])
  await expect.poll(() => reportResult(offerer), { timeout: 15_000 }).toMatchObject({
    connectionState: 'connected',
    dataChannelOpen: true,
    pongs: 3,
  })
  await expect.poll(() => reportResult(answerer), { timeout: 15_000 }).toMatchObject({
    connectionState: 'connected',
    dataChannelOpen: true,
    videoReceived: true,
  })

  await Promise.all([
    offerer.locator('#manual-reset').click(),
    answerer.locator('#manual-reset').click(),
  ])
  await expect.poll(() => allPeerConnectionsAreClosed(offerer)).toBe(true)
  await expect.poll(() => allPeerConnectionsAreClosed(answerer)).toBe(true)
  await Promise.all([offererContext.close(), answererContext.close()])
})

async function trackPeerConnections(page: Page) {
  await page.addInitScript(() => {
    const NativePeerConnection = window.RTCPeerConnection
    const peers: RTCPeerConnection[] = []
    class TrackedPeerConnection extends NativePeerConnection {
      constructor(configuration?: RTCConfiguration) {
        super(configuration)
        peers.push(this)
      }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: TrackedPeerConnection })
    Object.defineProperty(window, '__icecheckPeers', { configurable: true, value: peers })
  })
}

async function reportResult(page: Page) {
  const report = await page.locator('#manual-report').textContent()
  try {
    return (JSON.parse(report || '{}') as { result?: unknown }).result || {}
  } catch {
    return {}
  }
}

async function allPeerConnectionsAreClosed(page: Page) {
  return page.evaluate(() => {
    const peers = (window as typeof window & { __icecheckPeers: RTCPeerConnection[] }).__icecheckPeers
    return peers.length > 0 && peers.every((peer) => peer.connectionState === 'closed')
  })
}
