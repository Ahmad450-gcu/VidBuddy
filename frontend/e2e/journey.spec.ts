import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end journeys against the real backend (yt-dlp + FFmpeg) and real media files
 * served by a local fixture server. Nothing here is mocked.
 */
const MEDIA = 'http://127.0.0.1:8011'
const shots = (name: string) => `e2e/.screens/${test.info().project.name}-${name}.png`

async function analyze(page: Page, url: string) {
  await page.goto('/')
  const input = page.getByLabel('Media link')
  await input.fill(url)
  await input.press('Enter')
  await expect(page.getByRole('region', { name: 'Download options' })).toBeVisible()
}

async function waitForCompletion(page: Page, title: string) {
  await page.goto('/downloads?tab=completed')
  const row = page.locator('li', { hasText: title }).first()
  await expect(row).toBeVisible({ timeout: 60_000 })
  await expect(row.getByRole('button', { name: /Watch|Play/ }).first()).toBeVisible({ timeout: 60_000 })
}

test.describe.configure({ mode: 'serial' })

test('desktop journey: link → video download → library → player', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop')
  await analyze(page, `${MEDIA}/large.mp4`)
  const card = page.getByRole('region', { name: 'Download options' })
  await expect(card.getByText('Direct link')).toBeVisible()
  await expect(card.getByRole('heading', { name: 'large' })).toBeVisible()
  await page.screenshot({ path: shots('analysis') })

  await card.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(page.getByText('Added to downloads')).toBeVisible()
  await waitForCompletion(page, 'large')
  await page.screenshot({ path: shots('downloads') })

  await page.goto('/library')
  const tile = page.getByRole('button', { name: 'Play large' }).first()
  await expect(tile).toBeVisible()
  await page.screenshot({ path: shots('library') })

  await tile.click()
  await expect(page).toHaveURL(/\/watch\//)
  const video = page.locator('video')
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true
    return v.play()
  })
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.3)
  expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(2)
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 6 })
  // keyboard shortcut: k toggles pause
  await page.mouse.move(400, 400)
  await page.keyboard.press('k')
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await page.screenshot({ path: shots('player') })
  // playback position is remembered on pause
  const id = page.url().split('/watch/')[1]
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect.poll(async () => (await (await page.request.get(`http://127.0.0.1:8010/api/media/${id}`)).json()).play_position).toBeGreaterThan(0)
})

test('audio extraction → mini player → playlist → search', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop')
  await analyze(page, `${MEDIA}/part0.mp4`)
  const card = page.getByRole('region', { name: 'Download options' })
  await card.getByRole('tab', { name: /Audio/ }).click()
  await card.getByRole('button', { name: /MP3/ }).click()
  await card.getByRole('button', { name: /^192/ }).click()
  await card.getByRole('button', { name: 'Download', exact: true }).click()
  await waitForCompletion(page, 'part0')

  await page.goto('/library?view=audio')
  const tile = page.getByRole('button', { name: 'Play part0' }).first()
  await tile.click()
  const audio = page.locator('audio')
  await expect.poll(async () => audio.evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.2)
  await expect(page.getByRole('button', { name: 'Open player' })).toBeVisible()
  await page.screenshot({ path: shots('mini-player') })

  // expanded player + queue
  await page.getByRole('button', { name: 'Open player' }).click()
  await expect(page.getByRole('dialog', { name: 'Now playing' })).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: shots('now-playing') })
  await page.getByRole('button', { name: 'Minimize player' }).click()

  // add to a new playlist through the item menu
  await page.locator('div.group', { hasText: 'part0' }).first().hover()
  await page.locator('div.group', { hasText: 'part0' }).first().getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Add to playlist' }).click()
  await page.getByLabel('New playlist name').fill('E2E Mix')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Created E2E Mix')).toBeVisible()
  await page.goto('/playlists')
  await expect(page.getByText('E2E Mix')).toBeVisible()
  await page.getByText('E2E Mix').click()
  await expect(page.getByRole('heading', { name: 'E2E Mix' })).toBeVisible()

  // search + filters
  await page.goto('/library')
  await page.getByLabel('Search library').fill('large')
  await expect(page.getByRole('button', { name: 'Play large' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play part0' })).toHaveCount(0)
  await page.getByLabel('Search library').fill('')
  await page.getByRole('tab', { name: /Videos/ }).click()
  await expect(page.getByRole('button', { name: 'Play part0' })).toHaveCount(0)

  await page.goto('/storage')
  await expect(page.getByText('Largest files')).toBeVisible()
  await page.screenshot({ path: shots('storage') })
  await page.goto('/settings')
  await expect(page.getByText('yt-dlp', { exact: true })).toBeVisible()
  await page.screenshot({ path: shots('settings'), fullPage: true })
})

test('unsupported links show a helpful error', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop')
  await page.goto('/')
  await page.getByLabel('Media link').fill(`${MEDIA}/page.html`)
  await page.getByLabel('Media link').press('Enter')
  await expect(page.getByRole('alert')).toContainText(/isn't supported|unavailable/i)
  await page.screenshot({ path: shots('error') })
})

test('light theme renders', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop')
  await page.goto('/settings')
  await page.getByRole('tab', { name: /Light/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.goto('/library')
  await expect(page.getByRole('button', { name: 'Play large' })).toBeVisible()
  await page.screenshot({ path: shots('library-light') })
  await page.goto('/')
  await page.screenshot({ path: shots('home-light') })
})

test('mobile layout: bottom nav, paste flow, library', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile')
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link', { name: 'Library' })).toBeVisible()
  await page.screenshot({ path: shots('home') })

  await analyze(page, `${MEDIA}/part1.mp4`)
  await page.screenshot({ path: shots('analysis'), fullPage: true })
  await page.getByRole('region', { name: 'Download options' }).getByRole('button', { name: 'Download', exact: true }).click()
  await waitForCompletion(page, 'part1')
  await page.screenshot({ path: shots('downloads') })

  await nav.getByRole('link', { name: 'Library' }).click()
  await expect(page.getByRole('button', { name: 'Play part1' })).toBeVisible()
  // no horizontal scroll on phones
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: shots('library') })

  // details sheet
  await page.getByRole('button', { name: /^part1/ }).first().click()
  await expect(page.getByRole('dialog', { name: 'Item details' })).toBeVisible()
  await page.screenshot({ path: shots('details') })
  await page.getByRole('button', { name: 'Close details' }).click()

  await nav.getByRole('link', { name: 'More' }).click()
  await expect(page.getByRole('link', { name: 'Storage' })).toBeVisible()
  await page.goto('/library')
  await page.getByRole('button', { name: 'Play part1' }).click()
  await expect(page).toHaveURL(/\/watch\//)
  await expect.poll(async () => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
  await page.screenshot({ path: shots('player') })
})

test('PWA: manifest, icons, service worker, offline shell, share target', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'desktop')
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.name).toContain('Haul')
  expect(manifest.display).toBe('standalone')
  expect(manifest.share_target.action).toBe('/share')
  for (const icon of manifest.icons.filter((i: { src: string }) => i.src.endsWith('.png'))) {
    expect((await page.request.get(icon.src)).status()).toBe(200)
  }

  await page.goto('/')
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(scope).toContain('127.0.0.1:4173')
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  // Offline: the app shell still loads from the service worker
  await context.setOffline(true)
  await page.goto('/library')
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  await context.setOffline(false)

  // Share target hand-off analyzes the shared link
  await page.goto(`/share?title=Look&text=${encodeURIComponent(`watch this ${MEDIA}/large.mp4 !`)}`)
  await expect(page.getByRole('region', { name: 'Download options' })).toBeVisible()
  await expect(page.getByText('This is already in your library as video.')).toBeVisible()
})
