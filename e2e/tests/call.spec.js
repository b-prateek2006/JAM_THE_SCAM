// The real PWA in Chromium against the running app. Chromium's fake capture device plays a WAV
// file as the microphone, so the whole live path runs: getUserMedia → worklet → WebSocket →
// endpointer → Whisper → detector → scorer → UI. Fixtures come from make_fixtures.py.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test as base } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => path.join(here, '..', 'fixtures', name)
const generated = (name) => path.join(here, '..', 'fixtures', 'generated', name)

// `mic` (a WAV path) launches a browser whose microphone plays that file. The fake mic loops it,
// so a test that waits long enough hears the call again; none needs to.
const test = base.extend({
  mic: [null, { option: true }],
  page: async ({ mic, page, baseURL, channel, headless }, use) => {
    if (!mic) return use(page)
    const browser = await chromium.launch({
      channel, headless,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${mic}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    })
    const context = await browser.newContext({ baseURL, permissions: ['microphone'] })
    try {
      await use(await context.newPage())
    } finally {
      await browser.close()
    }
  },
})
const asMic = (wav) => ({ mic: wav })

// L3 is off so the outcome doesn't depend on an LLM key or its rate limits.
async function open(page, source, extra = {}) {
  const settings = { lang: 'en', source, scenario: 'inspector_sharma', use_l3: false, voice_demo: false, ...extra }
  await page.addInitScript((s) => localStorage.setItem('jam-settings', JSON.stringify(s)), settings)
  // The mic option is disabled until /api/health says server speech-to-text is ready (Whisper loads after start).
  await expect.poll(async () => (await (await page.request.get('/api/health')).json()).stt?.ready, { timeout: 90_000 }).toBe(true)
  await page.goto('/#/live')
  if (source === 'mic') await expect(page.locator('option[value=mic]')).toBeEnabled()
}

const guard = (page) => page.getByRole('button', { name: /Start guarding this call/ }).click()
const panel = (page) => page.locator('section.live-panel')
const lines = (page) => page.locator('.transcript .line:not(.interim)')

test.describe('microphone: scam call', () => {
  test.use(asMic(fixture('scam.wav')))

  test('goes critical while the call is still going', async ({ page }) => {
    await open(page, 'mic')
    await guard(page)
    await expect(lines(page).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.mic-hint')).toHaveCount(0)
    await expect(panel(page)).toHaveClass(/level-3/, { timeout: 150_000 })
    expect(await lines(page).count()).toBeGreaterThan(2)
  })
})

test.describe('microphone: scam call heard from a speakerphone across the desk', () => {
  test.use(asMic(generated('scam_farfield.wav')))

  test('still goes critical', async ({ page }) => {
    await open(page, 'mic')
    await guard(page)
    await expect(panel(page)).toHaveClass(/level-3/, { timeout: 150_000 })
  })
})

test.describe('microphone: genuine bank call', () => {
  test.use(asMic(fixture('genuine.wav')))

  test('never reaches a warning', async ({ page }) => {
    await open(page, 'mic')
    await guard(page)
    const seen = []
    // Sample the level through the whole call (56 s), not just at the end.
    for (let i = 0; i < 30 && (await lines(page).count()) < 7; i++) {
      seen.push(await panel(page).getAttribute('class'))
      await page.waitForTimeout(2500)
    }
    seen.push(await panel(page).getAttribute('class'))
    expect(await lines(page).count()).toBeGreaterThanOrEqual(5)
    expect(seen.filter((c) => /level-[23]/.test(c))).toEqual([])
  })
})

test.describe('microphone: silence (the app on the same phone as the call)', () => {
  test.use(asMic(generated('silence.wav')))

  test('says it cannot hear the call', async ({ page }) => {
    await open(page, 'mic')
    await guard(page)
    await expect(page.locator('.mic-hint')).toContainText(/second device/, { timeout: 20_000 })
    await expect(lines(page)).toHaveCount(0)
  })
})

test.describe('recorded call (audio file)', () => {
  test('goes critical and ends with a report', async ({ page }) => {
    await open(page, 'file')
    await page.locator('input[type=file]').setInputFiles(fixture('scam.wav'))
    await guard(page)
    await expect(panel(page)).toHaveClass(/level-3/, { timeout: 150_000 })
    // When the file finishes the call ends by itself and the report opens.
    await expect(page.getByRole('heading', { name: 'Incident report' })).toBeVisible({ timeout: 150_000 })
    await expect(page.getByText(/1930/).first()).toBeVisible()
  })
})

test.describe('demo scenario', () => {
  test('Inspector Sharma goes critical', async ({ page }) => {
    await open(page, 'demo')
    await guard(page)
    await expect(panel(page)).toHaveClass(/level-3/, { timeout: 90_000 })
  })
})
