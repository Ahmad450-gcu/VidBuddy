import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type MediaQuery } from '../../lib/api'
import type { MediaItem } from '../../lib/types'
import { useUi } from '../../stores/ui'

const PAGE = 120

/** Paged library query that refetches when the library changes (SSE `media` events). */
export function useMediaList(query: MediaQuery) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [sources, setSources] = useState<string[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const version = useUi((s) => s.libraryVersion)
  const key = JSON.stringify(query)
  const seq = useRef(0)
  const countRef = useRef(PAGE)

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const res = await api.media({ ...JSON.parse(key), limit: Math.max(PAGE, countRef.current), offset: 0 })
      if (mine !== seq.current) return
      setItems(res.items)
      setTotal(res.total)
      setSources(res.sources)
      setStatus('ready')
    } catch (e) {
      if (mine !== seq.current) return
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [key])

  useEffect(() => {
    countRef.current = PAGE
    setStatus('loading')
  }, [key])

  useEffect(() => {
    load()
  }, [load, version])

  const loadMore = useCallback(async () => {
    if (loadingMore || items.length >= total) return
    setLoadingMore(true)
    try {
      const res = await api.media({ ...JSON.parse(key), limit: PAGE, offset: items.length })
      setItems((cur) => [...cur, ...res.items.filter((r) => !cur.some((c) => c.id === r.id))])
      countRef.current = items.length + res.items.length
    } finally {
      setLoadingMore(false)
    }
  }, [items.length, total, key, loadingMore])

  const patchLocal = useCallback((id: string, patch: Partial<MediaItem>) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }, [])

  return { items, total, sources, status, error, reload: load, loadMore, loadingMore, patchLocal }
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}
