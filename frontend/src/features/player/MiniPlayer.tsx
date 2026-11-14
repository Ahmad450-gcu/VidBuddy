import { useEffect } from 'react'
import { ChevronDown, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, X } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { Thumb } from '../../components/ui/Thumb'
import { cn } from '../../lib/cn'
import { formatDuration } from '../../lib/format'
import { currentTrack, usePlayer } from '../../stores/player'
import { audioElement, seekAudio, useAudioTime } from './AudioEngine'

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]

function SeekBar({ className }: { className?: string }) {
  const { time, duration, buffered } = useAudioTime()
  const pct = duration ? (time / duration) * 100 : 0
  return (
    <input
      type="range"
      aria-label="Seek"
      min={0}
      max={duration || 0}
      step={0.1}
      value={time}
      onChange={(e) => seekAudio(Number(e.target.value))}
      className={cn('haul-range on-surface', className)}
      style={{ '--pct': `${pct}%`, '--buf': `${duration ? (buffered / duration) * 100 : 0}%` } as React.CSSProperties}
    />
  )
}

function Times() {
  const { time, duration } = useAudioTime()
  return (
    <div className="flex justify-between font-mono text-[11px] text-fg-3 tabular">
      <span>{formatDuration(time)}</span>
      <span>{formatDuration(duration)}</span>
    </div>
  )
}

export function MiniPlayer() {
  const track = usePlayer(currentTrack)
  const s = usePlayer()
  const { time, duration } = useAudioTime()

  useEffect(() => {
    if (!s.expanded) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && s.setExpanded(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.expanded, s])

  if (!track) return null
  const RepeatIcon = s.repeat === 'one' ? Repeat1 : Repeat

  return (
    <>
      {/* Compact bar */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface-1/95 backdrop-blur-md md:bottom-0 md:left-60 lg:left-64',
          s.expanded && 'hidden',
        )}
      >
        <div className="absolute inset-x-0 top-0 h-[2px] bg-surface-3 md:hidden">
          <div className="h-full bg-accent" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
        </div>
        <div className="mx-auto flex h-[68px] max-w-6xl items-center gap-3 px-3 md:h-20 md:px-6">
          <button onClick={() => s.setExpanded(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left md:flex-none md:w-72" aria-label="Open player">
            <Thumb item={track} className="size-11 md:size-12" showDuration={false} iconSize={18} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{track.title}</span>
              <span className="block truncate text-[12px] text-fg-3">{track.uploader ?? track.source}</span>
            </span>
          </button>
          <div className="hidden flex-1 flex-col items-center gap-0.5 md:flex">
            <div className="flex items-center gap-1">
              <IconButton label="Shuffle" size="sm" active={s.shuffle} onClick={s.toggleShuffle}>
                <Shuffle size={16} />
              </IconButton>
              <IconButton label="Previous" size="sm" onClick={() => ((audioElement()?.currentTime ?? 0) > 3 ? seekAudio(0) : s.prev())}>
                <SkipBack size={18} className="fill-current" />
              </IconButton>
              <IconButton label={s.playing ? 'Pause' : 'Play'} tone="accent" onClick={() => s.setPlaying(!s.playing)}>
                {s.playing ? <Pause size={18} className="fill-current" /> : <Play size={18} className="ml-0.5 fill-current" />}
              </IconButton>
              <IconButton label="Next" size="sm" onClick={() => s.next()}>
                <SkipForward size={18} className="fill-current" />
              </IconButton>
              <IconButton label={`Repeat: ${s.repeat}`} size="sm" active={s.repeat !== 'off'} onClick={s.cycleRepeat}>
                <RepeatIcon size={16} />
              </IconButton>
            </div>
            <div className="flex w-full max-w-xl items-center gap-2">
              <span className="w-10 text-right font-mono text-[11px] text-fg-3 tabular">{formatDuration(time)}</span>
              <SeekBar className="flex-1" />
              <span className="w-10 font-mono text-[11px] text-fg-3 tabular">{formatDuration(duration)}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 md:w-72 md:justify-end">
            <IconButton label={s.playing ? 'Pause' : 'Play'} className="md:hidden" onClick={() => s.setPlaying(!s.playing)}>
              {s.playing ? <Pause size={20} className="fill-current" /> : <Play size={20} className="ml-0.5 fill-current" />}
            </IconButton>
            <IconButton label="Next" className="md:hidden" onClick={() => s.next()}>
              <SkipForward size={18} className="fill-current" />
            </IconButton>
            <button
              onClick={() => s.setRate(RATES[(RATES.indexOf(s.rate) + 1) % RATES.length])}
              className="hidden h-8 rounded-md px-2 font-mono text-[12px] text-fg-2 hover:bg-surface-2 hover:text-fg md:block"
              aria-label="Playback speed"
              title="Playback speed"
            >
              {s.rate}×
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={s.volume}
              onChange={(e) => s.setVolume(Number(e.target.value))}
              className="haul-range on-surface hidden w-24 lg:block"
              style={{ '--pct': `${s.volume * 100}%` } as React.CSSProperties}
            />
            <IconButton label="Queue" size="sm" className="hidden md:inline-flex" onClick={() => s.setExpanded(true)}>
              <ListMusic size={17} />
            </IconButton>
            <IconButton label="Close player" size="sm" onClick={s.clear}>
              <X size={16} />
            </IconButton>
          </div>
        </div>
      </div>

      {/* Expanded player + queue */}
      {s.expanded && (
        <div role="dialog" aria-modal="true" aria-label="Now playing" className="safe-top safe-bottom fixed inset-0 z-50 flex flex-col bg-bg animate-fade">
          <div className="flex items-center justify-between px-4 py-3 md:px-8">
            <IconButton label="Minimize player" onClick={() => s.setExpanded(false)}>
              <ChevronDown size={22} />
            </IconButton>
            <span className="text-[12px] font-medium uppercase tracking-wide text-fg-3">Now playing</span>
            <IconButton label="Close player" onClick={s.clear}>
              <X size={18} />
            </IconButton>
          </div>
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-8 overflow-y-auto px-6 pb-6 md:flex-row md:items-center md:gap-12 md:px-10">
            <div className="flex flex-col items-center md:w-[400px] md:shrink-0">
              <Thumb item={track} className="aspect-square w-full max-w-[min(340px,70vw)] shadow-pop" rounded="rounded-xl" showDuration={false} iconSize={56} />
              <div className="mt-6 w-full max-w-[400px] text-center">
                <h2 className="line-clamp-2 text-lg font-semibold">{track.title}</h2>
                <p className="mt-1 text-[13px] text-fg-2">{track.uploader ?? track.source}</p>
              </div>
              <div className="mt-5 w-full max-w-[400px]">
                <SeekBar />
                <Times />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <IconButton label="Shuffle" active={s.shuffle} onClick={s.toggleShuffle}>
                  <Shuffle size={18} />
                </IconButton>
                <IconButton label="Previous" size="lg" onClick={() => ((audioElement()?.currentTime ?? 0) > 3 ? seekAudio(0) : s.prev())}>
                  <SkipBack size={22} className="fill-current" />
                </IconButton>
                <IconButton label={s.playing ? 'Pause' : 'Play'} tone="accent" size="lg" className="size-16" onClick={() => s.setPlaying(!s.playing)}>
                  {s.playing ? <Pause size={26} className="fill-current" /> : <Play size={26} className="ml-1 fill-current" />}
                </IconButton>
                <IconButton label="Next" size="lg" onClick={() => s.next()}>
                  <SkipForward size={22} className="fill-current" />
                </IconButton>
                <IconButton label={`Repeat: ${s.repeat}`} active={s.repeat !== 'off'} onClick={s.cycleRepeat}>
                  <RepeatIcon size={18} />
                </IconButton>
              </div>
              <div className="mt-4 flex items-center gap-1 rounded-lg bg-surface-1 p-1">
                {RATES.map((r) => (
                  <button
                    key={r}
                    onClick={() => s.setRate(r)}
                    className={cn('h-7 rounded-md px-2 font-mono text-[11.5px]', s.rate === r ? 'bg-surface-3 text-fg' : 'text-fg-3 hover:text-fg')}
                  >
                    {r}×
                  </button>
                ))}
              </div>
            </div>
            <section aria-label="Queue" className="min-h-0 flex-1 md:max-h-[70vh] md:overflow-y-auto scrollbar-thin">
              <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-fg-3">Up next · {s.queue.length}</h3>
              <ol>
                {s.order.map((qi) => {
                  const item = s.queue[qi]
                  if (!item) return null
                  const current = qi === s.index
                  return (
                    <li key={item.id} className={cn('group flex items-center gap-3 rounded-md px-2 py-1.5', current ? 'bg-surface-2' : 'hover:bg-surface-1')}>
                      <button onClick={() => s.jump(qi)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <Thumb item={item} className="size-10" showDuration={false} iconSize={14} />
                        <span className="min-w-0">
                          <span className={cn('block truncate text-[13px]', current ? 'font-semibold text-accent' : 'text-fg')}>{item.title}</span>
                          <span className="block truncate text-[12px] text-fg-3">{formatDuration(item.duration)}</span>
                        </span>
                      </button>
                      <IconButton label="Remove from queue" size="sm" className="opacity-100 md:opacity-0 md:group-hover:opacity-100" onClick={() => s.removeAt(qi)}>
                        <X size={14} />
                      </IconButton>
                    </li>
                  )
                })}
              </ol>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
