import { create } from 'zustand'
import { kv } from '../lib/idb'
import type { MediaItem } from '../lib/types'

export type Repeat = 'off' | 'all' | 'one'

interface PlayerState {
  queue: MediaItem[]
  index: number
  order: number[] // playback order (shuffled or identity) as indexes into queue
  playing: boolean
  shuffle: boolean
  repeat: Repeat
  rate: number
  volume: number
  expanded: boolean
  /** Context for the video player's next/previous buttons */
  videoContext: string[]
  playAudio: (items: MediaItem[], startIndex?: number) => void
  enqueue: (items: MediaItem[]) => void
  removeAt: (i: number) => void
  jump: (i: number) => void
  next: (auto?: boolean) => void
  prev: () => void
  setPlaying: (p: boolean) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  setRate: (r: number) => void
  setVolume: (v: number) => void
  setExpanded: (e: boolean) => void
  clear: () => void
  setVideoContext: (ids: string[]) => void
  hydrate: () => Promise<void>
}

const identity = (n: number) => Array.from({ length: n }, (_, i) => i)

function shuffled(n: number, first: number): number[] {
  const rest = identity(n).filter((i) => i !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [first, ...rest]
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  order: [],
  playing: false,
  shuffle: false,
  repeat: 'off',
  rate: 1,
  volume: 1,
  expanded: false,
  videoContext: [],

  playAudio: (items, startIndex = 0) => {
    const audio = items.filter((i) => i.status === 'ready')
    if (!audio.length) return
    const start = Math.max(0, audio.findIndex((x) => x.id === items[startIndex]?.id))
    const order = get().shuffle ? shuffled(audio.length, start) : identity(audio.length)
    set({ queue: audio, index: start, order, playing: true })
  },
  enqueue: (items) => {
    const s = get()
    if (!s.queue.length) return s.playAudio(items)
    const add = items.filter((i) => i.status === 'ready' && !s.queue.some((q) => q.id === i.id))
    const queue = [...s.queue, ...add]
    const order = [...s.order, ...add.map((_, k) => s.queue.length + k)]
    set({ queue, order })
  },
  removeAt: (i) => {
    const s = get()
    if (i === s.index) {
      if (s.queue.length === 1) return get().clear()
      get().next()
    }
    const cur = get().queue[get().index]
    const queue = s.queue.filter((_, k) => k !== i)
    const order = s.order.filter((k) => k !== i).map((k) => (k > i ? k - 1 : k))
    set({ queue, order, index: Math.max(0, queue.findIndex((q) => q.id === cur?.id)) })
  },
  jump: (i) => set({ index: i, playing: true }),
  next: (auto = false) => {
    const s = get()
    if (!s.queue.length) return
    if (auto && s.repeat === 'one') {
      set({ index: s.index, playing: true })
      return
    }
    const pos = s.order.indexOf(s.index)
    if (pos < s.order.length - 1) set({ index: s.order[pos + 1], playing: true })
    else if (s.repeat === 'all' || !auto) set({ index: s.order[0], playing: s.repeat === 'all' || !auto })
    else set({ playing: false })
  },
  prev: () => {
    const s = get()
    const pos = s.order.indexOf(s.index)
    set({ index: s.order[Math.max(0, pos - 1)], playing: true })
  },
  setPlaying: (playing) => set({ playing }),
  toggleShuffle: () => {
    const s = get()
    const shuffle = !s.shuffle
    set({ shuffle, order: shuffle ? shuffled(s.queue.length, Math.max(0, s.index)) : identity(s.queue.length) })
  },
  cycleRepeat: () => set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),
  setRate: (rate) => set({ rate }),
  setVolume: (volume) => set({ volume }),
  setExpanded: (expanded) => set({ expanded }),
  clear: () => set({ queue: [], index: -1, order: [], playing: false, expanded: false }),
  setVideoContext: (videoContext) => set({ videoContext }),
  hydrate: async () => {
    const saved = await kv.get<Partial<PlayerState> | null>('player', null)
    if (saved?.queue?.length) {
      set({
        queue: saved.queue,
        index: saved.index ?? 0,
        order: saved.order?.length === saved.queue.length ? saved.order : identity(saved.queue.length),
        shuffle: !!saved.shuffle,
        repeat: saved.repeat ?? 'off',
        rate: saved.rate ?? 1,
        volume: saved.volume ?? 1,
        playing: false,
      })
    }
  },
}))

// Persist the queue locally so the mini-player survives reloads (not the play state).
let persistTimer: number | undefined
usePlayer.subscribe((s) => {
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    kv.set('player', { queue: s.queue, index: s.index, order: s.order, shuffle: s.shuffle, repeat: s.repeat, rate: s.rate, volume: s.volume })
  }, 400)
})

export const currentTrack = (s: PlayerState) => (s.index >= 0 ? s.queue[s.index] : undefined)
