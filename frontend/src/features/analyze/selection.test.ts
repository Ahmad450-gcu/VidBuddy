import { describe, expect, it } from 'vitest'
import type { MediaAnalysis } from '../../lib/types'
import { DEFAULT_PREFS } from '../../stores/prefs'
import { audioTracks, clipRange, estimateSize, formatClock, initialSelection, parseClock, toOptions, trackLabel } from './selection'

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

describe('audio track', () => {
  const multi = analysis({
    formats: [
      { format_id: '600', ext: 'mp4', height: 720, width: 1280, fps: 25, vcodec: null, acodec: null, abr: null, tbr: 600, filesize: 40_000_000, exact_size: false, protocol: 'm3u8_native', note: null, has_video: true, has_audio: false, dynamic_range: null, language: null },
      { format_id: 'aac-3._English', ext: 'mp4', height: null, width: null, fps: null, vcodec: null, acodec: null, abr: 128, tbr: null, filesize: 2_000_000, exact_size: false, protocol: 'm3u8_native', note: 'English', has_video: false, has_audio: true, dynamic_range: null, language: 'en' },
      { format_id: 'aac-6._Hindi', ext: 'mp4', height: null, width: null, fps: null, vcodec: null, acodec: null, abr: 96, tbr: null, filesize: 1_500_000, exact_size: false, protocol: 'm3u8_native', note: 'Hindi', has_video: false, has_audio: true, dynamic_range: null, language: 'hi' },
    ],
  })

  it('lists the audio-only tracks with readable labels', () => {
    expect(audioTracks(multi).map((f) => f.format_id)).toEqual(['aac-3._English', 'aac-6._Hindi'])
    expect(trackLabel(audioTracks(multi)[1])).toBe('Hindi · aac-6._Hindi · 96 kbps')
  })

  it('sends the chosen track with the download and counts its size', () => {
    const sel = { ...initialSelection(multi, DEFAULT_PREFS), kind: 'video' as const, quality: 'fmt:600', audioTrack: 'aac-6._Hindi' }
    expect(toOptions(sel, DEFAULT_PREFS)).toMatchObject({ quality: 'fmt:600', audio_format_id: 'aac-6._Hindi' })
    expect(estimateSize(multi, sel)).toBe(41_500_000)
    expect(toOptions({ ...sel, audioTrack: null }, DEFAULT_PREFS).audio_format_id).toBeNull()
  })
})

describe('download only part of it', () => {
  it('reads times the way people type them', () => {
    expect(parseClock('1:02:03')).toBe(3723)
    expect(parseClock('62:03')).toBe(3723)
    expect(parseClock('90')).toBe(90)
    expect(parseClock('1h30m')).toBe(5400)
    expect(parseClock(' ')).toBeNull()
    expect(parseClock('abc')).toBeNaN()
    expect(formatClock(3723)).toBe('1:02:03')
    expect(formatClock(75)).toBe('1:15')
  })

  it('turns the range into options and explains mistakes', () => {
    const base = { ...initialSelection(analysis(), DEFAULT_PREFS), clipOn: true }
    expect(toOptions({ ...base, clipStart: '1:00:00', clipEnd: '2:00:00' }, DEFAULT_PREFS)).toMatchObject({ section_start: 3600, section_end: 7200 })
    expect(toOptions({ ...base, clipStart: '10:00' }, DEFAULT_PREFS)).toMatchObject({ section_start: 600, section_end: null })
    expect(toOptions({ ...base, clipOn: false, clipStart: '10:00' }, DEFAULT_PREFS).section_start).toBeUndefined()
    expect(clipRange({ ...base, clipStart: '5:00', clipEnd: '4:00' }, null)).toBe('The end must be after the start')
    expect(clipRange({ ...base, clipStart: 'x' }, null)).toMatch(/start/)
    expect(clipRange(base, null)).toBeNull() // nothing typed: the whole thing
  })
})
