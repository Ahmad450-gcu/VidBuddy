import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatEta, plural, resolutionLabel } from './format'
import { extractUrl } from './share'

describe('format', () => {
  it('formats bytes', () => {
    expect(formatBytes(null)).toBe('–')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('2 KB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
    expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB')
  })
  it('formats durations', () => {
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(null)).toBe('–:––')
  })
  it('formats eta and plurals', () => {
    expect(formatEta(30)).toBe('30s left')
    expect(formatEta(600)).toBe('10 min left')
    expect(formatEta(null)).toBe('')
    expect(plural(1, 'item')).toBe('1 item')
    expect(plural(3, 'item')).toBe('3 items')
    expect(resolutionLabel(2160)).toBe('4K')
    expect(resolutionLabel(720)).toBe('720p')
  })
})

describe('share target', () => {
  it('extracts the link from shared text', () => {
    expect(extractUrl('Watch this! https://youtu.be/abc?t=1.')).toBe('https://youtu.be/abc?t=1')
    expect(extractUrl('no link here')).toBeNull()
    expect(extractUrl(null)).toBeNull()
  })
})
