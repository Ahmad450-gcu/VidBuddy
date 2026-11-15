import type { CookieStatus,
  Analysis, DownloadOptions, Job, MediaItem, MediaKind, Playlist, Preferences, StorageInfo, SystemInfo,
} from './types'

/**
 * Typed API client. The base URL defaults to same-origin (the backend serves the SPA in
 * production, and Vite proxies /api in development). It can be pointed at a remote VidBuddy
 * server from Settings, which is useful when the PWA is installed from a static host.
 */
const TOKEN_KEY = 'haul.token'
const BASE_KEY = 'haul.server'

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export const connection = {
  get token() {
    return read(TOKEN_KEY)
  },
  get base() {
    return read(BASE_KEY).replace(/\/+$/, '')
  },
  set(token: string, base: string) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token)
      else localStorage.removeItem(TOKEN_KEY)
      if (base) localStorage.setItem(BASE_KEY, base.replace(/\/+$/, ''))
      else localStorage.removeItem(BASE_KEY)
    } catch {
      /* storage unavailable (private mode). Settings then last for the session only */
    }
  },
}

export class ApiError extends Error {
  status: number
  code: string
  detail?: string
  constructor(status: number, message: string, code = 'error', detail?: string) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** Build an absolute URL for things the browser fetches itself (<video src>, <img>, EventSource). */
export function apiUrl(path: string, params?: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URL(`${connection.base}/api${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v))
  }
  if (connection.token) u.searchParams.set('token', connection.token)
  return u.toString()
}

async function request<T>(method: string, path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
  const u = new URL(`${connection.base}/api${path}`, window.location.origin)
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v))
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (connection.token) headers.Authorization = `Bearer ${connection.token}`
  let res: Response
  try {
    res = await fetch(u, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, "Can't reach the VidBuddy server. Check your connection.", 'offline')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const d = detail as { code?: string; message?: string; detail?: string }
      throw new ApiError(res.status, d.message ?? 'Request failed.', d.code ?? 'error', d.detail)
    }
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: string; loc?: string[] }
      throw new ApiError(res.status, first?.msg ? `Invalid ${first.loc?.slice(-1)[0] ?? 'input'}: ${first.msg}` : 'Invalid input.', 'validation')
    }
    const code = res.status === 401 ? 'auth' : res.status === 429 ? 'rate_limited' : 'error'
    throw new ApiError(res.status, typeof detail === 'string' ? detail : `Request failed (${res.status}).`, code)
  }
  return data as T
}

export interface CreateDownload {
  url?: string
  title?: string | null
  thumbnail?: string | null
  kind: MediaKind
  options: Partial<DownloadOptions>
  priority?: number
  scheduled_at?: number | null
  entries?: { url: string; title?: string; thumbnail?: string | null }[]
  playlist_title?: string | null
  /** Optional request headers (raw text: `Name: value` lines, a cURL command, ...). */
  headers?: string
}

export interface MediaQuery {
  kind?: MediaKind
  q?: string
  favorite?: boolean
  sort?: 'created' | 'title' | 'size' | 'duration' | 'played'
  order?: 'asc' | 'desc'
  status?: 'ready' | 'missing'
  source?: string
  limit?: number
  offset?: number
}

export const api = {
  system: () => request<SystemInfo>('GET', '/system'),
  revealMedia: (id: string) => request<void>('POST', `/media/${id}/reveal`),
  openMediaFolder: () => request<void>('POST', '/system/open-media-folder'),
  health: () => request<{ ok: boolean }>('GET', '/health'),
  analyze: (url: string, refresh = false, headers = '') =>
    request<Analysis>('POST', '/analyze', { url, refresh, ...(headers.trim() ? { headers } : {}) }),

  downloads: (status?: string) =>
    request<{ items: Job[]; counts: Record<string, number>; concurrency: number }>('GET', '/downloads', undefined, { status }),
  createDownload: (body: CreateDownload) => request<{ items: Job[] }>('POST', '/downloads', body),
  pause: (id: string) => request<Job>('POST', `/downloads/${id}/pause`),
  resume: (id: string) => request<Job>('POST', `/downloads/${id}/resume`),
  retry: (id: string) => request<Job>('POST', `/downloads/${id}/retry`),
  cancel: (id: string) => request<Job>('POST', `/downloads/${id}/cancel`),
  patchJob: (id: string, body: { priority?: number; scheduled_at?: number | null; clear_schedule?: boolean }) =>
    request<Job>('PATCH', `/downloads/${id}`, body),
  deleteJob: (id: string) => request<void>('DELETE', `/downloads/${id}`),
  pauseAll: () => request<{ affected: number }>('POST', '/downloads/actions/pause-all'),
  resumeAll: () => request<{ affected: number }>('POST', '/downloads/actions/resume-all'),
  clearJobs: (scope: 'finished' | 'completed' | 'failed') =>
    request<{ affected: number }>('POST', '/downloads/actions/clear', undefined, { scope }),

  media: (q: MediaQuery = {}) =>
    request<{ items: MediaItem[]; total: number; sources: string[] }>('GET', '/media', undefined, q as Record<string, unknown>),
  mediaItem: (id: string) => request<MediaItem>('GET', `/media/${id}`),
  patchMedia: (id: string, body: { title?: string; favorite?: boolean; play_position?: number; rename_file?: boolean }) =>
    request<MediaItem>('PATCH', `/media/${id}`, body),
  played: (id: string) => request<void>('POST', `/media/${id}/played`),
  fetchSubtitles: (id: string, lang = 'en') => request<MediaItem>('POST', `/media/${id}/subtitles`, { lang }),
  deleteMedia: (id: string, deleteFile = true) => request<void>('DELETE', `/media/${id}`, undefined, { delete_file: deleteFile }),
  bulkDelete: (ids: string[], deleteFile = true) =>
    request<{ affected: number }>('POST', '/media/bulk-delete', { ids, delete_file: deleteFile }),
  duplicates: () => request<{ groups: { reason: string; items: MediaItem[] }[] }>('GET', '/media/duplicates'),
  rescan: () => request<{ missing: number; restored: number; imported: number }>('POST', '/media/rescan'),

  playlists: () => request<{ items: Playlist[] }>('GET', '/playlists'),
  playlist: (id: string) => request<Playlist>('GET', `/playlists/${id}`),
  createPlaylist: (name: string, media_ids: string[] = []) => request<Playlist>('POST', '/playlists', { name, media_ids }),
  patchPlaylist: (id: string, body: { name?: string; order?: string[] }) => request<Playlist>('PATCH', `/playlists/${id}`, body),
  deletePlaylist: (id: string) => request<void>('DELETE', `/playlists/${id}`),
  addToPlaylist: (id: string, media_ids: string[]) => request<Playlist>('POST', `/playlists/${id}/items`, { media_ids }),
  removeFromPlaylist: (id: string, mediaId: string) => request<Playlist>('DELETE', `/playlists/${id}/items/${mediaId}`),

  storage: () => request<StorageInfo>('GET', '/storage'),
  cleanupTemp: () => request<{ removed: number }>('POST', '/storage/cleanup-temp'),

  settings: () => request<Preferences>('GET', '/settings'),
  saveSettings: (body: Partial<Preferences>) => request<Preferences>('PUT', '/settings', body),

  cookies: () => request<CookieStatus>('GET', '/cookies'),
  saveCookies: (content: string) => request<CookieStatus>('PUT', '/cookies', { content }),
  clearCookies: () => request<CookieStatus>('DELETE', '/cookies'),
}

export const mediaUrls = {
  stream: (id: string) => apiUrl(`/media/${id}/stream`),
  file: (id: string) => apiUrl(`/media/${id}/file`),
  audio: (id: string) => apiUrl(`/media/${id}/audio`),
  thumb: (id: string) => apiUrl(`/media/${id}/thumbnail`),
  subtitle: (id: string, lang: string) => apiUrl(`/media/${id}/subtitles/${encodeURIComponent(lang)}`),
}
