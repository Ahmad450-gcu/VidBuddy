// Types mirror the backend API (see docs/04-api.md).

export type MediaKind = 'video' | 'audio'
export type JobStatus = 'queued' | 'downloading' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface SourceInfo {
  key: string
  name: string
  extractor: string | null
  domain: string
}

export interface Format {
  format_id: string
  ext: string | null
  height: number | null
  width: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  abr: number | null
  tbr: number | null
  filesize: number | null
  exact_size: boolean
  protocol: string | null
  note: string | null
  has_video: boolean
  has_audio: boolean
  dynamic_range: string | null
  language: string | null
}

export interface VideoPreset {
  id: string
  height: number | null
  label: string
  fps: number | null
  codecs: string[]
  hdr: boolean
  size_estimate: number | null
}

export interface AudioTarget {
  id: AudioFormat
  label: string
  lossy: boolean
}

export interface Presets {
  video: VideoPreset[]
  audio: {
    targets: AudioTarget[]
    bitrates: number[]
    source_abr: number | null
    source_codec: string | null
    size_estimate: number | null
  }
  containers: Container[]
  has_video: boolean
  has_audio: boolean
}

export interface MediaAnalysis {
  type: 'media'
  url: string
  source: SourceInfo
  id: string
  title: string
  uploader: string | null
  thumbnail: string | null
  duration: number | null
  upload_date: string | null
  view_count: number | null
  description: string
  formats: Format[]
  presets: Presets
  subtitles: { manual: string[]; automatic: string[] }
  warnings: string[]
  cached: boolean
  existing?: Record<MediaKind, MediaItem | null>
}

export interface PlaylistEntry {
  index: number
  id: string | null
  url: string
  title: string
  duration: number | null
  thumbnail: string | null
  uploader: string | null
}

export interface PlaylistAnalysis {
  type: 'playlist'
  url: string
  source: SourceInfo
  id: string | null
  title: string
  uploader: string | null
  thumbnail: string | null
  entry_count: number
  entries: PlaylistEntry[]
  warnings: string[]
  cached: boolean
}

export type Analysis = MediaAnalysis | PlaylistAnalysis

export type Container = 'mp4' | 'webm' | 'mkv'
export type AudioFormat = 'mp3' | 'm4a' | 'aac' | 'opus' | 'flac' | 'wav'

export interface DownloadOptions {
  quality: string
  container: Container
  audio_format: AudioFormat
  audio_bitrate: number
  subtitles: boolean
  subtitle_langs: string[]
  auto_subtitles: boolean
  embed_metadata: boolean
  embed_thumbnail: boolean
  filename_template?: string | null
  /** A specific audio track (format id) to merge with the video; null = best audio. */
  audio_format_id?: string | null
}

export interface Job {
  id: string
  url: string
  source: string | null
  title: string | null
  thumbnail: string | null
  kind: MediaKind
  options: DownloadOptions & { kind: MediaKind; headers?: Record<string, string> }
  status: JobStatus
  priority: number
  progress: number
  downloaded_bytes: number
  total_bytes: number | null
  speed: number | null
  eta: number | null
  stage: string | null
  error: string | null
  error_code: string | null
  attempts: number
  playlist_title: string | null
  media_id: string | null
  scheduled_at: number | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

export interface Subtitle {
  lang: string
  path: string
}

export interface MediaItem {
  id: string
  job_id: string | null
  title: string
  uploader: string | null
  source: string | null
  source_url: string | null
  kind: MediaKind
  path: string
  filename: string
  folder: string
  size: number
  duration: number | null
  mime: string | null
  ext: string | null
  width: number | null
  height: number | null
  vcodec: string | null
  acodec: string | null
  has_thumbnail: boolean
  subtitles: Subtitle[]
  favorite: boolean
  play_position: number
  play_count: number
  last_played_at: number | null
  content_hash: string | null
  status: 'ready' | 'missing'
  created_at: number
  playlists?: { id: string; name: string }[]
}

export interface Playlist {
  id: string
  name: string
  created_at: number
  updated_at: number
  count?: number
  duration?: number
  cover_id?: string | null
  items?: MediaItem[]
}

export interface StorageInfo {
  total_size: number
  total_count: number
  by_kind: Partial<Record<MediaKind, { count: number; size: number }>>
  by_source: { source: string; count: number; size: number }[]
  by_ext: { ext: string; count: number; size: number }[]
  largest: MediaItem[]
  recent: MediaItem[]
  disk: { total: number; used: number; free: number } | null
  media_root: string
  duplicate_groups: number
  reclaimable: number
  missing: number
  temp_jobs: number
}

export interface Preferences {
  max_concurrent: number
  default_kind: MediaKind
  default_quality: string
  default_container: Container
  default_audio_format: AudioFormat
  default_audio_bitrate: number
  filename_template: string
  subtitles: boolean
  subtitle_langs: string[]
  embed_metadata: boolean
  embed_thumbnail: boolean
  skip_duplicates: boolean
}

export interface SystemInfo {
  engine: {
    yt_dlp: string
    yt_dlp_ejs: string | null
    curl_cffi: string | null
    ffmpeg: string | null
    ffprobe: string | null
    js_runtime: string | null
  }
  media_root: string
  auth: boolean
  supported_site_count: number
  desktop?: boolean
}

export interface ApiErrorBody {
  code?: string
  message?: string
  detail?: string
}

export interface CookieStatus {
  present: boolean
  count: number
  sites: string[]
  youtube: boolean
  google?: boolean
  updated_at: number | null
}
