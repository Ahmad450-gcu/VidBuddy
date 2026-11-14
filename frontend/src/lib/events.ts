import { apiUrl } from './api'
import type { Job, MediaItem } from './types'
import { useDownloads } from '../stores/downloads'
import { useUi } from '../stores/ui'

type MediaEvent =
  | { action: 'added'; media: MediaItem }
  | { action: 'updated'; media: MediaItem }
  | { action: 'deleted'; ids: string[] }

type CompletedListener = (job: Job, media: MediaItem) => void
const completedListeners = new Set<CompletedListener>()
export const onMediaAdded = (fn: CompletedListener) => {
  completedListeners.add(fn)
  return () => completedListeners.delete(fn)
}

/**
 * Real-time channel (Server-Sent Events). SSE suits this traffic: it's one-directional
 * (server → client), auto-reconnects, passes through proxies, and needs no extra library.
 * After any reconnect we reload the job list, since events may have been missed.
 */
export function connectEvents(): () => void {
  let es: EventSource | null = null
  let retry = 1000
  let timer: number | undefined
  let closed = false

  const open = () => {
    if (closed) return
    useUi.getState().setConn('connecting')
    es = new EventSource(apiUrl('/events'))
    es.addEventListener('hello', () => {
      retry = 1000
      useUi.getState().setConn('online')
      useDownloads.getState().load().catch(() => undefined)
    })
    es.addEventListener('job', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Partial<Job> & { id: string }
      const store = useDownloads.getState()
      if (store.jobs[data.id]) store.patch(data.id, data)
      else store.load().catch(() => undefined)
    })
    es.addEventListener('job_created', (e) => {
      useDownloads.getState().upsert(JSON.parse((e as MessageEvent).data) as Job)
    })
    es.addEventListener('job_deleted', (e) => {
      useDownloads.getState().remove((JSON.parse((e as MessageEvent).data) as { id: string }).id)
    })
    es.addEventListener('media', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as MediaEvent
      useUi.getState().bumpLibrary()
      if (data.action === 'added') {
        const job = Object.values(useDownloads.getState().jobs).find((j) => j.media_id === data.media.id || j.id === data.media.job_id)
        if (job) completedListeners.forEach((l) => l(job, data.media))
      }
    })
    es.addEventListener('settings', (e) => {
      const s = JSON.parse((e as MessageEvent).data) as { max_concurrent: number }
      useDownloads.setState({ concurrency: s.max_concurrent })
    })
    es.onerror = () => {
      es?.close()
      es = null
      if (closed) return
      // Distinguish "server down" from "token rejected" with a cheap probe.
      fetch(apiUrl('/health'))
        .then((r) => useUi.getState().setConn(r.status === 401 ? 'unauthorized' : 'offline'))
        .catch(() => useUi.getState().setConn('offline'))
      timer = window.setTimeout(open, retry)
      retry = Math.min(retry * 2, 15000)
    }
  }

  const onOnline = () => {
    if (!es) {
      window.clearTimeout(timer)
      retry = 1000
      open()
    }
  }
  window.addEventListener('online', onOnline)
  open()
  return () => {
    closed = true
    window.clearTimeout(timer)
    window.removeEventListener('online', onOnline)
    es?.close()
  }
}
