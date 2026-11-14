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
  setUrl: (url: string) => void
  analyze: (url?: string, refresh?: boolean) => Promise<void>
  reset: () => void
  loadRecent: () => Promise<void>
}

let seq = 0

export const useAnalysis = create<AnalysisState>((set, get) => ({
  url: '',
  status: 'idle',
  data: null,
  error: null,
  recent: [],
  setUrl: (url) => set({ url }),
  analyze: async (input, refresh = false) => {
    const url = (input ?? get().url).trim()
    if (!url) return
    const mine = ++seq
    set({ url, status: 'loading', error: null, data: null })
    try {
      const data = await api.analyze(url, refresh)
      if (mine !== seq) return
      set({ status: 'ready', data })
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
    set({ url: '', status: 'idle', data: null, error: null })
  },
  loadRecent: async () => set({ recent: await kv.get<string[]>('recent-links', []) }),
}))
