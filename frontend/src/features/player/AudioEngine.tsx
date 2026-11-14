import { useEffect, useRef, useSyncExternalStore } from 'react'
import { api, mediaUrls } from '../../lib/api'
import { supports } from '../../lib/platform'
import { currentTrack, usePlayer } from '../../stores/player'
import { toast } from '../../stores/ui'

/**
 * A single <audio> element for the whole app, mounted once at the root so playback
 * survives route changes. UI components read its state through `useAudioTime`.
 * Background playback and lock-screen controls come from the Media Session API.
 */
let el: HTMLAudioElement | null = null
export const audioElement = () => el

const listeners = new Set<() => void>()
let snapshot = { time: 0, duration: 0, buffered: 0, waiting: false }
function emit() {
  if (!el) return
  const b = el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0
  snapshot = { time: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0, buffered: b, waiting: snapshot.waiting }
  listeners.forEach((l) => l())
}
export function useAudioTime() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshot,
  )
}

export function seekAudio(t: number) {
  if (el && Number.isFinite(t)) {
    el.currentTime = Math.max(0, Math.min(t, el.duration || t))
    emit()
  }
}

export function AudioEngine() {
  const ref = useRef<HTMLAudioElement>(null)
  const track = usePlayer(currentTrack)
  const playing = usePlayer((s) => s.playing)
  const rate = usePlayer((s) => s.rate)
  const volume = usePlayer((s) => s.volume)
  const lastSaved = useRef(0)
  const resumeAt = useRef<number | null>(null)

  useEffect(() => {
    el = ref.current
    usePlayer.getState().hydrate()
    return () => {
      el = null
    }
  }, [])

  // Load a new track
  useEffect(() => {
    const a = ref.current
    if (!a) return
    if (!track) {
      a.removeAttribute('src')
      a.load()
      emit()
      return
    }
    const src = mediaUrls.stream(track.id)
    if (a.src !== src) {
      a.src = src
      resumeAt.current = track.play_position > 5 && (!track.duration || track.play_position < track.duration - 5) ? track.play_position : null
      api.played(track.id).catch(() => undefined)
    }
    if (supports.mediaSession) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.uploader ?? track.source ?? '',
        album: 'VidBuddy',
        artwork: track.has_thumbnail ? [{ src: mediaUrls.thumb(track.id), sizes: '512x512' }] : [],
      })
    }
  }, [track])

  // Play / pause sync
  useEffect(() => {
    const a = ref.current
    if (!a || !track) return
    if (playing) {
      a.play().catch((e: DOMException) => {
        if (e.name === 'NotAllowedError') usePlayer.getState().setPlaying(false)
        else if (e.name !== 'AbortError') {
          usePlayer.getState().setPlaying(false)
          toast({ tone: 'danger', title: "Couldn't play this file", body: track.title })
        }
      })
    } else a.pause()
    if (supports.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [playing, track])

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate
  }, [rate, track])
  useEffect(() => {
    if (ref.current) ref.current.volume = volume
  }, [volume])

  // Lock screen / hardware media keys
  useEffect(() => {
    if (!supports.mediaSession) return
    const ms = navigator.mediaSession
    const s = usePlayer.getState
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => s().setPlaying(true)],
      ['pause', () => s().setPlaying(false)],
      ['nexttrack', () => s().next()],
      ['previoustrack', () => (el && el.currentTime > 3 ? seekAudio(0) : s().prev())],
      ['seekbackward', (d) => seekAudio((el?.currentTime ?? 0) - (d.seekOffset ?? 10))],
      ['seekforward', (d) => seekAudio((el?.currentTime ?? 0) + (d.seekOffset ?? 10))],
      ['seekto', (d) => d.seekTime !== undefined && seekAudio(d.seekTime)],
    ]
    for (const [a, h] of handlers) {
      try {
        ms.setActionHandler(a, h)
      } catch {
        /* action unsupported on this platform */
      }
    }
  }, [])

  // Keyboard shortcuts for the audio player (the video page has its own set).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (window.location.pathname.startsWith('/watch')) return
      const s = usePlayer.getState()
      if (!el || s.index < 0 || !s.queue.length) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (tag === 'INPUT' && (t as HTMLInputElement).type !== 'range') return
      // let focused buttons/links keep Space and Enter, and open dialogs/menus keep their keys
      if ((tag === 'BUTTON' || tag === 'A') && (e.key === ' ' || e.key === 'Enter')) return
      if (document.querySelector('[role="dialog"]:not([aria-label="Now playing"]), [role="menu"], dialog[open]')) return
      const k = e.key
      if (k === ' ' || k === 'k') s.setPlaying(!s.playing)
      else if (k === 'ArrowLeft' || k === 'j') seekAudio(el.currentTime - (k === 'j' ? 10 : 5))
      else if (k === 'ArrowRight' || k === 'l') seekAudio(el.currentTime + (k === 'l' ? 10 : 5))
      else if (k === 'ArrowUp' && tag !== 'INPUT') s.setVolume(Math.min(1, Math.round((s.volume + 0.05) * 100) / 100))
      else if (k === 'ArrowDown' && tag !== 'INPUT') s.setVolume(Math.max(0, Math.round((s.volume - 0.05) * 100) / 100))
      else if (k === 'm') s.setVolume(s.volume > 0 ? 0 : 1)
      else if (k === 'N') s.next()
      else if (k === 'P') (el.currentTime > 3 ? seekAudio(0) : s.prev())
      else if (/^[0-9]$/.test(k) && el.duration) seekAudio((Number(k) / 10) * el.duration)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const savePosition = (force = false) => {
    const a = ref.current
    const t = usePlayer.getState().queue[usePlayer.getState().index]
    if (!a || !t || !a.duration) return
    const now = Date.now()
    if (!force && now - lastSaved.current < 10000) return
    lastSaved.current = now
    const pos = a.currentTime > a.duration - 5 ? 0 : a.currentTime
    api.patchMedia(t.id, { play_position: pos }).catch(() => undefined)
  }

  return (
    <audio
      ref={ref}
      preload="metadata"
      onLoadedMetadata={(e) => {
        if (resumeAt.current) {
          e.currentTarget.currentTime = resumeAt.current
          resumeAt.current = null
        }
        emit()
      }}
      onTimeUpdate={() => {
        emit()
        savePosition()
        const a = ref.current
        if (a && supports.mediaSession && a.duration && 'setPositionState' in navigator.mediaSession) {
          try {
            navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate })
          } catch {
            /* ignore */
          }
        }
      }}
      onProgress={emit}
      onWaiting={() => {
        snapshot = { ...snapshot, waiting: true }
        listeners.forEach((l) => l())
      }}
      onPlaying={() => {
        snapshot = { ...snapshot, waiting: false }
        emit()
        if (!usePlayer.getState().playing) usePlayer.getState().setPlaying(true)
      }}
      onPause={() => {
        savePosition(true)
        if (usePlayer.getState().playing && ref.current && !ref.current.ended) usePlayer.getState().setPlaying(false)
      }}
      onEnded={() => {
        savePosition(true)
        usePlayer.getState().next(true)
      }}
      onError={() => {
        if (!track) return
        toast({ tone: 'danger', title: "Couldn't play this file", body: `${track.title}. It may have been moved or deleted.` })
        usePlayer.getState().setPlaying(false)
      }}
    />
  )
}
