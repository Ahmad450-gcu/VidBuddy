import { memo } from 'react'
import { Check, EllipsisVertical, Heart, Play } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Feedback'
import { Menu, type MenuItem } from '../../components/ui/Menu'
import { Thumb } from '../../components/ui/Thumb'
import { cn } from '../../lib/cn'
import { formatBytes, formatDuration, formatRelative, resolutionLabel } from '../../lib/format'
import type { MediaItem } from '../../lib/types'

interface TileProps {
  item: MediaItem
  selecting: boolean
  selected: boolean
  focused: boolean
  onOpen: () => void
  onPlay: () => void
  onToggleSelect: () => void
  menu: MenuItem[]
}

function metaLine(item: MediaItem) {
  return [item.uploader ?? item.source, item.kind === 'video' ? resolutionLabel(item.height) : item.ext?.toUpperCase(), formatBytes(item.size)].filter(Boolean).join(' · ')
}

function progressPct(item: MediaItem) {
  return item.duration && item.play_position > 5 ? Math.min(1, item.play_position / item.duration) : 0
}

export const MediaCard = memo(function MediaCard({ item, selecting, selected, focused, onOpen, onPlay, onToggleSelect, menu }: TileProps) {
  const pct = progressPct(item)
  return (
    <div
      className={cn(
        'group relative rounded-lg p-1.5 transition-colors',
        selected ? 'bg-accent-soft ring-1 ring-accent' : focused ? 'bg-surface-2' : 'hover:bg-surface-1',
      )}
    >
      <button
        onClick={selecting ? onToggleSelect : onPlay}
        onContextMenu={(e) => {
          e.preventDefault()
          onToggleSelect()
        }}
        className="relative block w-full overflow-hidden rounded-md text-left"
        aria-label={selecting ? `Select ${item.title}` : `Play ${item.title}`}
      >
        <Thumb item={item} className="aspect-video w-full" rounded="rounded-md" iconSize={28} />
        {pct > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40">
            <span className="block h-full bg-accent" style={{ width: `${pct * 100}%` }} />
          </span>
        )}
        {!selecting && (
          <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="grid size-11 place-items-center rounded-full bg-black/60 backdrop-blur">
              <Play size={20} className="ml-0.5 fill-white text-white" />
            </span>
          </span>
        )}
        {item.status === 'missing' && (
          <span className="absolute left-1.5 top-1.5">
            <Badge tone="danger">File missing</Badge>
          </span>
        )}
      </button>
      {(selecting || selected) && (
        <button
          onClick={onToggleSelect}
          aria-label={selected ? 'Deselect' : 'Select'}
          className={cn(
            'absolute left-3 top-3 grid size-6 place-items-center rounded-full ring-2 ring-white/80 transition',
            selected ? 'bg-accent text-accent-fg ring-accent' : 'bg-black/40',
          )}
        >
          {selected && <Check size={14} strokeWidth={3} />}
        </button>
      )}
      <div className="flex items-start gap-1 px-0.5 pt-2">
        <button onClick={selecting ? onToggleSelect : onOpen} className="min-w-0 flex-1 text-left">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-fg">{item.title}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-fg-3">
            {item.favorite && <Heart size={11} className="shrink-0 fill-accent text-accent" />}
            <span className="truncate">{metaLine(item)}</span>
          </p>
        </button>
        <Menu
          trigger={(p) => (
            <IconButton label="More" size="sm" className="-mr-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:aria-expanded:opacity-100" {...p}>
              <EllipsisVertical size={16} />
            </IconButton>
          )}
          items={menu}
        />
      </div>
    </div>
  )
})

export const MediaRow = memo(function MediaRow({ item, selecting, selected, focused, onOpen, onPlay, onToggleSelect, menu }: TileProps) {
  const pct = progressPct(item)
  return (
    <li
      className={cn(
        'group flex items-center gap-3 px-3 py-2 transition-colors md:px-4',
        selected ? 'bg-accent-soft' : focused ? 'bg-surface-2' : 'hover:bg-surface-1',
      )}
    >
      {selecting && (
        <input type="checkbox" aria-label={`Select ${item.title}`} checked={selected} onChange={onToggleSelect} className="size-4 shrink-0 accent-[var(--accent)]" />
      )}
      <button onClick={selecting ? onToggleSelect : onPlay} className="relative shrink-0" aria-label={`Play ${item.title}`}>
        <Thumb item={item} className={item.kind === 'audio' ? 'size-11' : 'aspect-video w-20'} showDuration={false} iconSize={16} />
        {pct > 0 && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-accent" style={{ width: `${pct * 100}%` }} />}
      </button>
      <button onClick={selecting ? onToggleSelect : onOpen} className="min-w-0 flex-1 text-left">
        <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-fg">
          {item.favorite && <Heart size={12} className="shrink-0 fill-accent text-accent" />}
          <span className="truncate">{item.title}</span>
          {item.status === 'missing' && <Badge tone="danger">Missing</Badge>}
        </p>
        <p className="truncate text-[12px] text-fg-3">{metaLine(item)}</p>
      </button>
      <span className="hidden w-16 text-right text-[12px] text-fg-3 tabular sm:block">{formatDuration(item.duration)}</span>
      <span className="hidden w-24 text-right text-[12px] text-fg-3 lg:block">{formatRelative(item.created_at)}</span>
      <Menu
        trigger={(p) => (
          <IconButton label="More" size="sm" {...p}>
            <EllipsisVertical size={16} />
          </IconButton>
        )}
        items={menu}
      />
    </li>
  )
})
