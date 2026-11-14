import { describe, expect, it } from 'vitest'
import type { MediaAnalysis } from '../../lib/types'
import { DEFAULT_PREFS } from '../../stores/prefs'
import { estimateSize, initialSelection, toOptions } from './selection'

const analysis = (over: Partial<MediaAnalysis> = {}): MediaAnalysis => ({
  type: 'media',
  url: 'https://example.com/v',
  source: { key: 'youtube', name: 'YouTube', extractor: 'Youtube', domain: 'youtube.com' },
  id: 'x',
  title: 'Clip',
  uploader: null,
  thumbnail: null,
  duration: 100,
  upload_date: null,
  view_count: null,
  description: '',
  formats: [
    { format_id: '137', ext: 'mp4', height: 1080, width: 1920, fps: 30, vcodec: 'avc1', acodec: null, abr: null, tbr: 4000, filesize: 50_000_000, exact_size: true, protocol: 'https', note: null, has_video: true, has_audio: false, dynamic_range: null, language: null },
  ],
  presets: {
    video: [
      { id: 'h720', height: 720, label: '720p', fps: 30, codecs: ['H.264'], hdr: false, size_estimate: 20_000_000 },
      { id: 'h480', height: 480, label: '480p', fps: 30, codecs: ['H.264'], hdr: false, size_estimate: 10_000_000 },
    ],
    audio: { targets: [], bitrates: [128, 192, 320], source_abr: 128, source_codec: 'opus', size_estimate: 1_000_000 },
    containers: ['mp4', 'webm', 'mkv'],
    has_video: true,
    has_audio: true,
  },
  subtitles: { manual: [], automatic: ['en', 'de'] },
  warnings: [],
  cached: false,
  ...over,
})

describe('initialSelection', () => {
  it('falls back to the nearest available quality below the preference', () => {
    const sel = initialSelection(analysis(), { ...DEFAULT_PREFS, default_quality: 'h1080' })
    expect(sel.quality).toBe('h720')
  })
  it('uses audio when the source has no video', () => {
    const a = analysis()
    a.presets = { ...a.presets, video: [], has_video: false }
    expect(initialSelection(a, DEFAULT_PREFS).kind).toBe('audio')
  })
  it('marks subtitles as automatic when no manual track exists', () => {
    const sel = initialSelection(analysis(), { ...DEFAULT_PREFS, subtitles: true })
    expect(sel.subtitles).toBe(true)
    expect(sel.subtitleLang).toBe('en')
    expect(sel.autoSubtitles).toBe(true)
  })
})

describe('toOptions / estimateSize', () => {
  it('drops bitrate for lossless audio', () => {
    const sel = { ...initialSelection(analysis(), DEFAULT_PREFS), kind: 'audio' as const, audioFormat: 'flac' as const, audioBitrate: 320 }
    expect(toOptions(sel, DEFAULT_PREFS).audio_bitrate).toBe(0)
  })
  it('estimates audio and exact-format sizes', () => {
    const base = initialSelection(analysis(), DEFAULT_PREFS)
    expect(estimateSize(analysis(), { ...base, kind: 'audio', audioFormat: 'mp3', audioBitrate: 128 })).toBe(1_600_000)
    expect(estimateSize(analysis(), { ...base, kind: 'video', quality: 'fmt:137' })).toBe(51_000_000)
    expect(estimateSize(analysis(), { ...base, kind: 'video', quality: 'h480' })).toBe(10_000_000)
  })
})
