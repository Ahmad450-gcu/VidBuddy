// Renders the Haul mark to the PNG sizes the PWA manifest and iOS need.
// Usage: node scripts/gen-icons.mjs
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const mark = (pad, radius, bg = '#151517') => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
  <rect width="64" height="64" rx="${radius}" fill="${bg}"/>
  <g transform="translate(${pad} ${pad}) scale(${(64 - pad * 2) / 64})">
    <path d="M32 14v24" stroke="#ffb547" stroke-width="6" stroke-linecap="round"/>
    <path d="M21 29l11 11 11-11" fill="none" stroke="#ffb547" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18 49h28" stroke="#ededef" stroke-width="6" stroke-linecap="round"/>
  </g>
</svg>`

const targets = [
  ['public/icons/icon-192.png', 192, mark(0, 14)],
  ['public/icons/icon-512.png', 512, mark(0, 14)],
  ['public/icons/maskable-512.png', 512, mark(10, 0)], // full-bleed with safe-zone padding
  ['public/icons/apple-touch-icon.png', 180, mark(4, 0)],
]

await mkdir('public/icons', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size, svg] of targets) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  await page.screenshot({ path: file, omitBackground: true })
  console.log('wrote', file)
}
await browser.close()
