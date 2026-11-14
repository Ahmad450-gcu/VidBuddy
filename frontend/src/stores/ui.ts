import { create } from 'zustand'

export type Theme = 'system' | 'dark' | 'light'
export type ConnState = 'connecting' | 'online' | 'offline' | 'unauthorized'

export interface Toast {
  id: number
  tone: 'neutral' | 'success' | 'danger'
  title: string
  body?: string
  action?: { label: string; run: () => void }
  duration?: number
}

interface UiState {
  theme: Theme
  conn: ConnState
  libraryVersion: number
  toasts: Toast[]
  setTheme: (t: Theme) => void
  setConn: (c: ConnState) => void
  bumpLibrary: () => void
  toast: (t: Omit<Toast, 'id'>) => number
  dismiss: (id: number) => void
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('haul.theme')
    return t === 'dark' || t === 'light' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelectorAll('meta[name="theme-color"]')
  meta.forEach((m) => m.setAttribute('content', dark ? '#0e0e10' : '#f7f6f3'))
}

let toastSeq = 1

export const useUi = create<UiState>((set, get) => ({
  theme: readTheme(),
  conn: 'connecting',
  libraryVersion: 0,
  toasts: [],
  setTheme: (theme) => {
    try {
      localStorage.setItem('haul.theme', theme)
    } catch {
      /* ignore */
    }
    applyTheme(theme)
    set({ theme })
  },
  setConn: (conn) => set({ conn }),
  bumpLibrary: () => set((s) => ({ libraryVersion: s.libraryVersion + 1 })),
  toast: (t) => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    const duration = t.duration ?? (t.action ? 7000 : 4000)
    window.setTimeout(() => get().dismiss(id), duration)
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

export const toast = (t: Omit<Toast, 'id'>) => useUi.getState().toast(t)

export function toastError(e: unknown, title = 'Something went wrong') {
  const msg = e instanceof Error ? e.message : String(e)
  toast({ tone: 'danger', title, body: msg })
}
