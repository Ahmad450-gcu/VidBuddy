import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Captions, CaptionsOff, Download, Film, Gauge, Headphones, Heart, Loader2, Music, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX,
} from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { ErrorState, Spinner } from '../../components/ui/Feedback'
import { Menu } from '../../components/ui/Menu'
import { api, mediaUrls } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatDuration } from '../../lib/format'
import { supports } from '../../lib/platform'
import type { MediaItem } from '../../lib/types'
import { usePlayer } from '../../stores/player'
import { toast } from '../../stores/ui'
import { listenToItem, saveAudio, saveItem, toggleFavorite } from '../library/actions'

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const LANG_NAMES = (() => {
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' })
  } catch {
    return null
  }
})()
const langName = (code: string) => {
  try {
    return LANG_NAMES?.of(code.replace(/-orig$/, '')) ?? code
  } catch {
    return code
  }
}
/** Languages offered when a video has no subtitles yet: English plus the browser's language. */
const WANTED_LANGS = [...new Set(['en', (navigator.language || 'en').split('-')[0]])]

type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

export function VideoPlayerPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState<MediaItem | null>(null)
  const [error, setError] = useState('')
  const context = usePlayer((s) => s.videoContext)

  useEffect(() => {
    let alive = true
    setItem(null)
    setError('')
    api.mediaItem(id).then(
      (m) => alive && (m.kind === 'video' || m.kind === 'audio' ? setItem(m) : setError('Not playable')),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    // pause background audio when a video starts
    usePlayer.getState().setPlaying(false)
    return () => {
      alive = false
    }
  }, [id])

  const pos = context.indexOf(id)
  const prevId = pos > 0 ? context[pos - 1] : null
  const nextId = pos >= 0 && pos < context.length - 1 ? context[pos + 1] : null

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-black p-6">
        <div className="w-full max-w-sm">
          <ErrorState message={error} onRetry={() => navigate(0)} />
          <button onClick={() => navigate(-1)} className="mt-4 w-full text-center text-[13px] text-white/70 hover:text-white">
            Go back
          </button>
        </div>
      </div>
    )
  }
  if (!item) {
    return (
      <div className="grid min-h-dvh place-items-center bg-black text-white/60">
        <Spinner size={28} />
      </div>
    )
  }
  return (
    <Player
      key={item.id}
      item={item}
      onChange={setItem}
      onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/library'))}
      onPrev={prevId ? () => navigate(`/watch/${prevId}`, { replace: true }) : undefined}
      onNext={nextId ? () => navigate(`/watch/${nextId}`, { replace: true }) : undefined}
    />
  )
}

function Player({ item, onChange, onBack, onPrev, onNext }: { item: MediaItem; onChange: (m: MediaItem) => void; onBack: () => void; onPrev?: () => void; onNext?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const video = useRef<WebkitVideo>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(item.duration ?? 0)
  const [buffered, setBuffered] = useState(0)
  const [waiting, setWaiting] = useState(true)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('haul.volume') ?? 1))
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [controls, setControls] = useState(true)
  const [subLang, setSubLang] = useState<string | null>(item.subtitles[0]?.lang ?? null)
  const [flash, setFlash] = useState<{ icon: 'back' | 'fwd'; key: number } | null>(null)
  const [fetchingSubs, setFetchingSubs] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const lastSave = useRef(0)
  const lastTap = useRef<{ t: number; x: number }>({ t: 0, x: 0 })

  // ---- position memory -----------------------------------------------------
  const savePosition = useCallback(
    (force = false) => {
      const v = video.current
      if (!v || !v.duration) return
      const now = Date.now()
      if (!force && now - lastSave.current < 5000) return
      lastSave.current = now
      const p = v.currentTime > v.duration - 10 ? 0 : v.currentTime
      api.patchMedia(item.id, { play_position: p }).catch(() => undefined)
    },
    [item.id],
  )
  useEffect(() => {
    const onHide = () => savePosition(true)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      savePosition(true)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [savePosition])

  // ---- controls visibility ---------------------------------------------------
  const poke = useCallback(() => {
    setControls(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (video.current && !video.current.paused) setControls(false)
    }, 2600)
  }, [])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  // ---- actions ---------------------------------------------------------------
  const toggle = useCallback(() => {
    const v = video.current
    if (!v) return
    if (v.paused) v.play().catch(() => undefined)
    else v.pause()
    poke()
  }, [poke])
  const seekBy = useCallback(
    (d: number) => {
      const v = video.current
      if (!v) return
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d))
      setFlash({ icon: d < 0 ? 'back' : 'fwd', key: Date.now() })
      poke()
    },
    [poke],
  )
  const toggleFullscreen = useCallback(async () => {
    const v = video.current
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
    else if (wrap.current?.requestFullscreen) {
      await wrap.current.requestFullscreen().catch(() => undefined)
      // lock landscape on phones where supported
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      o?.lock?.('landscape').catch(() => undefined)
    } else v?.webkitEnterFullscreen?.() // iOS Safari
  }, [])
  const togglePip = useCallback(async () => {
    const v = video.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch {
      toast({ tone: 'danger', title: 'Picture-in-picture is not available here' })
    }
  }, [])
  const getSubtitles = useCallback(
    async (lang: string) => {
      setFetchingSubs(true)
      try {
        const m = await api.fetchSubtitles(item.id, lang)
        onChange(m)
        const got = m.subtitles.find((s) => s.lang === lang || s.lang.startsWith(lang)) ?? m.subtitles[0]
        if (got) setSubLang(got.lang)
        toast({ tone: 'success', title: 'Subtitles added', body: got ? langName(got.lang) : undefined })
      } catch (e) {
        toast({ tone: 'danger', title: "Couldn't get subtitles", body: e instanceof Error ? e.message : String(e) })
      } finally {
        setFetchingSubs(false)
      }
    },
    [item.id, onChange],
  )
  const listen = () => {
    listenToItem(item, video.current?.currentTime)
    video.current?.pause()
    onBack()
  }
  const changeVolume = (v: number) => {
    setVolume(v)
    setMuted(v === 0)
    try {
      localStorage.setItem('haul.volume', String(v))
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (video.current) {
      video.current.volume = volume
      video.current.muted = muted
    }
  }, [volume, muted])
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate
  }, [rate])
  useEffect(() => {
    const v = video.current
    if (!v) return
    for (const t of Array.from(v.textTracks)) t.mode = t.language === subLang ? 'showing' : 'disabled'
  }, [subLang, item.subtitles])
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ---- keyboard shortcuts ----------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const v = video.current
      if (!v) return
      const k = e.key
      const handled = true
      if (k === ' ' || k === 'k') toggle()
      else if (k === 'ArrowLeft' || k === 'j') seekBy(k === 'j' ? -10 : -5)
      else if (k === 'ArrowRight' || k === 'l') seekBy(k === 'l' ? 10 : 5)
      else if (k === 'ArrowUp') changeVolume(Math.min(1, volume + 0.05))
      else if (k === 'ArrowDown') changeVolume(Math.max(0, volume - 0.05))
      else if (k === 'm') setMuted((m) => !m)
      else if (k === 'f') toggleFullscreen()
      else if (k === 'p' && supports.pictureInPicture) togglePip()
      else if (k === 'a') listen()
      else if (k === 'c' && item.subtitles.length) setSubLang((s) => (s ? null : item.subtitles[0].lang))
      else if (k === 'N' && onNext) onNext()
      else if (k === 'P' && onPrev) onPrev()
      else if (k === '>' || k === '.') setRate((r) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(r) + 1)])
      else if (k === '<' || k === ',') setRate((r) => SPEEDS[Math.max(0, SPEEDS.indexOf(r) - 1)])
      else if (/^[0-9]$/.test(k) && v.duration) v.currentTime = (Number(k) / 10) * v.duration
      else if (k === 'Escape' && !document.fullscreenElement) onBack()
      else return
      if (handled) {
        e.preventDefault()
        poke()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, seekBy, toggleFullscreen, togglePip, volume, item.subtitles, onNext, onPrev, onBack, poke])

  // ---- media session (lock screen, hardware keys) ------------------------------
  useEffect(() => {
    if (!supports.mediaSession) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.uploader ?? item.source ?? '',
      artwork: item.has_thumbnail ? [{ src: mediaUrls.thumb(item.id) }] : [],
    })
    try {
      navigator.mediaSession.setActionHandler('nexttrack', onNext ?? null)
      navigator.mediaSession.setActionHandler('previoustrack', onPrev ?? null)
    } catch {
      /* ignore */
    }
  }, [item, onNext, onPrev])

  // ---- touch: double-tap left/right to seek ------------------------------------
  const onSurfacePointer = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      toggle()
      return
    }
    const now = Date.now()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (now - lastTap.current.t < 300) {
      if (x < 0.35) seekBy(-10)
      else if (x > 0.65) seekBy(10)
      else toggle()
      lastTap.current = { t: 0, x }
    } else {
      lastTap.current = { t: now, x }
      if (controls) {
        window.setTimeout(() => {
          if (lastTap.current.t === now) setControls(false)
        }, 300)
      } else poke()
    }
  }

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const pct = duration ? (time / duration) * 100 : 0
  const show = controls || !playing

  return (
    <div
      ref={wrap}
      className={cn('relative flex h-dvh w-full select-none items-center justify-center overflow-hidden bg-black', !show && 'cursor-none')}
      onPointerMove={(e) => e.pointerType === 'mouse' && poke()}
    >
      <video
        ref={video}
        src={mediaUrls.stream(item.id)}
        crossOrigin="anonymous"
        playsInline
        autoPlay
        preload="auto"
        className="size-full object-contain"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          setDuration(v.duration)
          if (item.play_position > 5 && item.play_position < v.duration - 10) {
            v.currentTime = item.play_position
            toast({
              tone: 'neutral',
              title: `Resumed at ${formatDuration(item.play_position)}`,
              action: { label: 'Start over', run: () => video.current && (video.current.currentTime = 0) },
            })
          }
          for (const t of Array.from(v.textTracks)) t.mode = t.language === subLang ? 'showing' : 'disabled'
        }}
        onPlay={() => {
          setPlaying(true)
          poke()
          if (lastSave.current === 0) {
            lastSave.current = Date.now()
            api.played(item.id).catch(() => undefined)
          }
        }}
        onPause={() => {
          setPlaying(false)
          setControls(true)
          savePosition(true)
        }}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime)
          savePosition()
        }}
        onProgress={(e) => {
          const b = e.currentTarget.buffered
          if (b.length) setBuffered(b.end(b.length - 1))
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => {
          api.patchMedia(item.id, { play_position: 0 }).catch(() => undefined)
          if (onNext) onNext()
        }}
        onError={() => {
          setWaiting(false)
          toast({ tone: 'danger', title: "This file can't be played in your browser", body: 'Try saving it to your device and opening it in another player.' })
        }}
      >
        {item.subtitles.map((s) => (
          <track key={s.lang} kind="subtitles" srcLang={s.lang} label={langName(s.lang)} src={mediaUrls.subtitle(item.id, s.lang)} />
        ))}
      </video>

      {/* Gesture surface */}
      <div className="absolute inset-0" onPointerUp={onSurfacePointer} onDoubleClick={() => !supports.touch && toggleFullscreen()} />

      {waiting && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-white/80">
          <Spinner size={36} />
        </div>
      )}
      {flash && (
        <div
          key={flash.key}
          className={cn('pointer-events-none absolute top-1/2 grid size-20 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white animate-fade', flash.icon === 'back' ? 'left-[12%]' : 'right-[12%]')}
          onAnimationEnd={() => window.setTimeout(() => setFlash(null), 350)}
        >
          {flash.icon === 'back' ? <RotateCcw size={26} /> : <RotateCw size={26} />}
          <span className="absolute bottom-3 text-[10px] font-semibold">10s</span>
        </div>
      )}

      {/* Top bar */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-2 pb-10 pt-[max(8px,env(safe-area-inset-top))] transition-opacity duration-200 md:px-4',
          show ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <IconButton label="Back" tone="onMedia" onClick={onBack}>
          <ArrowLeft size={20} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-medium text-white md:text-[15px]">{item.title}</h1>
          {item.uploader && <p className="truncate text-[12px] text-white/60">{item.uploader}</p>}
        </div>
        <IconButton label={item.favorite ? 'Remove from favorites' : 'Add to favorites'} tone="onMedia" active={item.favorite} onClick={() => toggleFavorite(item, onChange)}>
          <Heart size={18} className={item.favorite ? 'fill-accent' : ''} />
        </IconButton>
        <IconButton label="Play as audio" tone="onMedia" onClick={listen}>
          <Headphones size={18} />
        </IconButton>
        <Menu
          align="end"
          trigger={(p) => (
            <IconButton label="Save to device" tone="onMedia" {...p}>
              <Download size={18} />
            </IconButton>
          )}
          items={[
            { label: `Save video${item.ext ? ` (${item.ext.toUpperCase()})` : ''}`, icon: <Film size={15} />, onSelect: () => saveItem(item) },
            { label: 'Save audio as MP3', icon: <Music size={15} />, onSelect: () => saveAudio(item) },
          ]}
        />
      </div>

      {/* Center play button on touch */}
      {show && !waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-10 md:hidden">
          <IconButton label="Back 10 seconds" tone="onMedia" size="lg" className="pointer-events-auto" onClick={() => seekBy(-10)}>
            <RotateCcw size={24} />
          </IconButton>
          <IconButton label={playing ? 'Pause' : 'Play'} tone="onMedia" size="lg" className="pointer-events-auto size-16 bg-black/40" onClick={toggle}>
            {playing ? <Pause size={30} className="fill-white" /> : <Play size={30} className="ml-1 fill-white" />}
          </IconButton>
          <IconButton label="Forward 10 seconds" tone="onMedia" size="lg" className="pointer-events-auto" onClick={() => seekBy(10)}>
            <RotateCw size={24} />
          </IconButton>
        </div>
      )}

      {/* Bottom controls */}
      <div
        className={cn(
          'safe-bottom absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pt-12 transition-opacity duration-200 md:px-5',
          show ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="flex items-center gap-3">
          <span className="w-12 text-right font-mono text-[11.5px] text-white/80 tabular">{formatDuration(time)}</span>
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => {
              if (video.current) video.current.currentTime = Number(e.target.value)
              setTime(Number(e.target.value))
              poke()
            }}
            className="haul-range flex-1"
            style={{ '--pct': `${pct}%`, '--buf': `${duration ? (buffered / duration) * 100 : 0}%` } as React.CSSProperties}
          />
          <span className="w-12 font-mono text-[11.5px] text-white/60 tabular">{formatDuration(duration)}</span>
        </div>
        <div className="flex items-center gap-0.5 pb-2 pt-1 md:gap-1">
          <IconButton label={playing ? 'Pause (k)' : 'Play (k)'} tone="onMedia" onClick={toggle} className="hidden md:inline-flex">
            {playing ? <Pause size={20} className="fill-white" /> : <Play size={20} className="ml-0.5 fill-white" />}
          </IconButton>
          <IconButton label="Previous (Shift+P)" tone="onMedia" disabled={!onPrev} onClick={onPrev}>
            <SkipBack size={18} className="fill-current" />
          </IconButton>
          <IconButton label="Next (Shift+N)" tone="onMedia" disabled={!onNext} onClick={onNext}>
            <SkipForward size={18} className="fill-current" />
          </IconButton>
          <div className="group/vol hidden items-center md:flex">
            <IconButton label="Mute (m)" tone="onMedia" onClick={() => setMuted((m) => !m)}>
              <VolumeIcon size={20} />
            </IconButton>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="haul-range w-0 opacity-0 transition-all duration-200 group-hover/vol:w-24 group-hover/vol:opacity-100 focus:w-24 focus:opacity-100"
              style={{ '--pct': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
          </div>
          <div className="flex-1" />
          <Menu
            align="end"
            trigger={(p) => (
              <button {...p} aria-label="Playback speed" title="Playback speed" className="flex h-10 items-center gap-1 rounded-full px-3 font-mono text-[12.5px] text-white/90 hover:bg-white/10">
                <Gauge size={17} /> {rate}×
              </button>
            )}
            items={SPEEDS.map((s) => ({ label: s === 1 ? 'Normal' : `${s}×`, onSelect: () => setRate(s), icon: s === rate ? <span className="size-1.5 rounded-full bg-accent" /> : undefined }))}
          />
          <Menu
            align="end"
            trigger={(p) => (
              <IconButton label="Subtitles (c)" tone="onMedia" active={!!subLang} {...p}>
                {fetchingSubs ? <Loader2 size={20} className="animate-spin" /> : subLang ? <Captions size={20} /> : <CaptionsOff size={20} />}
              </IconButton>
            )}
            items={[
              { label: 'Off', onSelect: () => setSubLang(null), icon: subLang === null ? <span className="size-1.5 rounded-full bg-accent" /> : undefined },
              ...item.subtitles.map((s) => ({ label: langName(s.lang), onSelect: () => setSubLang(s.lang), icon: subLang === s.lang ? <span className="size-1.5 rounded-full bg-accent" /> : undefined })),
              ...(item.source_url?.startsWith('http')
                ? WANTED_LANGS.filter((l) => !item.subtitles.some((s) => s.lang.split('-')[0] === l)).map((l) => ({
                    label: `Get ${langName(l)} subtitles`,
                    icon: <Download size={14} />,
                    disabled: fetchingSubs,
                    onSelect: () => getSubtitles(l),
                  }))
                : []),
            ]}
          />
          {supports.pictureInPicture && (
            <IconButton label="Picture in picture (p)" tone="onMedia" onClick={togglePip}>
              <PictureInPicture2 size={19} />
            </IconButton>
          )}
          <IconButton label={fullscreen ? 'Exit full screen (f)' : 'Full screen (f)'} tone="onMedia" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </IconButton>
        </div>
      </div>
    </div>
  )
}
