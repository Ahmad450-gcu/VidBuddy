import { create } from 'zustand'
import { ApiError, api } from '../../lib/api'
import { kv } from '../../lib/idb'
import type { Analysis } from '../../lib/types'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface AnalysisState {
  url: string
  status: Status
  data: Analysis | null
  error: { message: string; code: string } | null
  recent: string[]
  /** Optional request headers, for streams (raw .m3u8 etc.) that only answer the site's own player. */
  headersOpen: boolean
  referer: string
  headerText: string
  /** The headers the current `data` was read with; downloads queued from it send the same ones. */
  analyzedHeaders: string
  setUrl: (url: string) => void
  setHeadersOpen: (open: boolean) => void
  setReferer: (referer: string) => void
  setHeaderText: (text: string) => void
  analyze: (url?: string, refresh?: boolean) => Promise<void>
  reset: () => void
  loadRecent: () => Promise<void>
}

/** Referer field + free-form headers -> the raw text the API parses (later lines win). */
export function composeHeaders(referer: string, text: string): string {
  const lines: string[] = []
  if (referer.trim()) lines.push(`Referer: ${referer.trim()}`)
  if (text.trim()) lines.push(text.trim())
  return lines.join('\n')
}

/** How many headers the text holds, for the collapsed toggle's badge (a cURL command counts its -H flags). */
export function countHeaders(referer: string, text: string): number {
  const t = text.trim()
  let n = 0
  if (/^curl(\.exe)?\s/i.test(t)) n = (t.match(/(^|\s)(-H|--header|-e|--referer|-A|--user-agent|-b|--cookie)\s/g) ?? []).length
  else if (t.startsWith('{')) {
    try {
      n = Object.keys(JSON.parse(t) as object).length
    } catch {
      n = 1
    }
  } else n = t.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith(':')).length
  return n + (referer.trim() ? 1 : 0)
}

/** A pasted "Copy as cURL" command: the stream URL in it (bash or Windows cmd quoting). */
export function urlFromCurl(text: string): string | null {
  if (!/^\s*curl(\.exe)?\s/i.test(text)) return null
  const m = text.match(/https?:\/\/[^\s'"^]+/)
  return m ? m[0] : null
}

let seq = 0

export const useAnalysis = create<AnalysisState>((set, get) => ({
  url: '',
  status: 'idle',
  data: null,
  error: null,
  recent: [],
  headersOpen: false,
  referer: '',
  headerText: '',
  analyzedHeaders: '',
  setUrl: (url) => set({ url }),
  setHeadersOpen: (headersOpen) => set({ headersOpen }),
  setReferer: (referer) => set({ referer }),
  setHeaderText: (headerText) => set({ headerText }),
  analyze: async (input, refresh = false) => {
    const url = (input ?? get().url).trim()
    if (!url) return
    const mine = ++seq
    const headers = composeHeaders(get().referer, get().headerText)
    set({ url, status: 'loading', error: null, data: null })
    try {
      const data = await api.analyze(url, refresh, headers)
      if (mine !== seq) return
      set({ status: 'ready', data, analyzedHeaders: headers })
      const recent = [url, ...get().recent.filter((r) => r !== url)].slice(0, 8)
      set({ recent })
      kv.set('recent-links', recent)
    } catch (e) {
      if (mine !== seq) return
      const err = e instanceof ApiError ? { message: e.message, code: e.code } : { message: String(e), code: 'error' }
      set({ status: 'error', error: err })
    }
  },
  reset: () => {
    seq++
    // Headers often carry a site's tokens, so they go with the link rather than lingering for the next one.
    set({ url: '', status: 'idle', data: null, error: null, referer: '', headerText: '', analyzedHeaders: '', headersOpen: false })
  },
  loadRecent: async () => set({ recent: await kv.get<string[]>('recent-links', []) }),
}))
