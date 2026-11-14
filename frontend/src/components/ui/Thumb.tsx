import { useState } from 'react'
import { Film, Music2 } from 'lucide-react'
import { mediaUrls } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatDuration } from '../../lib/format'
import type { MediaItem, MediaKind } from '../../lib/types'

/** Thumbnail with graceful fallback. Remote URLs (pre-download) or a library item's stored thumbnail. */
export function Thumb({
  item,
  src,
  kind = 'video',
  duration,
  className,
  rounded = 'rounded-md',
  showDuration = true,
  iconSize = 22,
}: {
  item?: Pick<MediaItem, 'id' | 'has_thumbnail' | 'kind' | 'duration'>
  src?: string | null
  kind?: MediaKind
  duration?: number | null
  className?: string
  rounded?: string
  showDuration?: boolean
  iconSize?: number
}) {
  const [failed, setFailed] = useState(false)
  const url = item ? (item.has_thumbnail ? mediaUrls.thumb(item.id) : null) : src
  const k = item?.kind ?? kind
  const d = item?.duration ?? duration
  const Icon = k === 'audio' ? Music2 : Film
  return (
    <div className={cn('relative shrink-0 overflow-hidden bg-surface-3', rounded, className)}>
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="grid size-full place-items-center text-fg-3">
          <Icon size={iconSize} strokeWidth={1.5} />
        </div>
      )}
      {showDuration && d ? (
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-px font-mono text-[10.5px] font-medium text-white tabular">
          {formatDuration(d)}
        </span>
      ) : null}
    </div>
  )
}
