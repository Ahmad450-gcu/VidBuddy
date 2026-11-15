import type { AudioFormat, Container, DownloadOptions, Format, MediaAnalysis, MediaKind, Preferences } from '../../lib/types'

/** What the user picked in the analysis card. Pure data, so it can be unit tested. */
export interface Selection {
  kind: MediaKind
  quality: string // 'best' | 'h1080' | 'fmt:<id>'
  container: Container
  audioFormat: AudioFormat
  audioBitrate: number
  subtitles: boolean
  subtitleLang: string
  autoSubtitles: boolean
  embedThumbnail: boolean
  /** Audio-only format id to merge in (one language of several); null = the best audio. */
  audioTrack: string | null
}

export const LOSSLESS: AudioFormat[] = ['flac', 'wav']

export function initialSelection(a: MediaAnalysis, prefs: Preferences): Selection {
  const kind: MediaKind = a.presets.has_video ? prefs.default_kind : 'audio'
  const heights = a.presets.video.map((v) => v.id)
  let quality = prefs.default_quality
  if (quality !== 'best' && !heights.includes(quality)) {
    // nearest available at or below the preferred height, else the best there is
    const want = Number(quality.slice(1)) || Infinity
    quality = a.presets.video.find((v) => (v.height ?? 0) <= want)?.id ?? 'best'
  }
  const langs = [...a.subtitles.manual, ...a.subtitles.automatic]
  const preferredLang = prefs.subtitle_langs.find((l) => langs.includes(l)) ?? (langs.includes('en') ? 'en' : langs[0] ?? 'en')
  return {
    kind,
    quality,
    container: prefs.default_container,
    audioFormat: prefs.default_audio_format,
    audioBitrate: prefs.default_audio_bitrate,
    subtitles: prefs.subtitles && langs.length > 0,
    subtitleLang: preferredLang,
    autoSubtitles: !a.subtitles.manual.includes(preferredLang),
    embedThumbnail: prefs.embed_thumbnail,
    audioTrack: null,
  }
}

export function toOptions(sel: Selection, prefs: Pick<Preferences, 'embed_metadata' | 'filename_template'>): Partial<DownloadOptions> {
  return {
    quality: sel.kind === 'video' ? sel.quality : 'best',
    container: sel.container,
    audio_format: sel.audioFormat,
    audio_bitrate: LOSSLESS.includes(sel.audioFormat) ? 0 : sel.audioBitrate,
    subtitles: sel.kind === 'video' && sel.subtitles,
    subtitle_langs: [sel.subtitleLang],
    auto_subtitles: sel.autoSubtitles,
    embed_metadata: prefs.embed_metadata,
    embed_thumbnail: sel.embedThumbnail,
    filename_template: prefs.filename_template,
    audio_format_id: sel.audioTrack,
  }
}

/** Estimated output size in bytes for the current selection, or null when unknown. */
export function estimateSize(a: MediaAnalysis, sel: Selection): number | null {
  if (sel.kind === 'audio') {
    if (!a.duration) return a.presets.audio.size_estimate
    if (sel.audioFormat === 'wav') return Math.round(a.duration * 44100 * 2 * 2)
    if (sel.audioFormat === 'flac') return Math.round(a.duration * 44100 * 2 * 2 * 0.6)
    const kbps = sel.audioBitrate || (sel.audioFormat === 'opus' ? 160 : 245)
    return Math.round((kbps * 1000 * a.duration) / 8)
  }
  const track = sel.audioTrack ? a.formats.find((x) => x.format_id === sel.audioTrack) : undefined
  const audioSize = track ? track.filesize : a.presets.audio.size_estimate
  if (sel.quality.startsWith('fmt:')) {
    const f = a.formats.find((x) => x.format_id === sel.quality.slice(4))
    if (!f?.filesize) return null
    return f.has_audio && !track ? f.filesize : f.filesize + (audioSize ?? 0)
  }
  if (sel.quality === 'best') return a.presets.video[0]?.size_estimate ?? null
  return a.presets.video.find((v) => v.id === sel.quality)?.size_estimate ?? null
}

/** The audio-only streams, i.e. the tracks (often one per language) that can be merged with a video. */
export function audioTracks(a: MediaAnalysis): Format[] {
  return a.formats.filter((f) => f.has_audio && !f.has_video)
}

let languageNames: Intl.DisplayNames | null = null
function languageName(code: string): string {
  try {
    languageNames ??= new Intl.DisplayNames(['en'], { type: 'language' })
    return languageNames.of(code) ?? code
  } catch {
    return code
  }
}

/** "Hindi · aac-6._Hindi · 128 kbps": language first when the site says what it is. */
export function trackLabel(f: Format): string {
  const lang = f.language && f.language !== 'und' ? languageName(f.language) : null
  const kbps = f.abr ? `${Math.round(f.abr)} kbps` : f.tbr ? `${Math.round(f.tbr)} kbps` : null
  return [lang, f.note && f.note !== lang ? f.note : null, f.format_id, kbps].filter(Boolean).join(' · ')
}
