import { useEffect, useState } from 'react'
import { Copy, Download, ExternalLink, Headphones, Heart, ListPlus, Music, Pencil, Play, Share2, Trash2, X } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Feedback'
import { Thumb } from '../../components/ui/Thumb'
import { api } from '../../lib/api'
import { formatBytes, formatDate, formatDuration } from '../../lib/format'
import type { MediaItem } from '../../lib/types'
import { toast } from '../../stores/ui'
import { listenToItem, saveAudio, saveItem, saveItemLabel, shareItem, toggleFavorite } from './actions'

export interface DetailsActions {
  onPlay: () => void
  onRename: () => void
  onDelete: () => void
  onAddToPlaylist: () => void
  onChanged: (m: MediaItem) => void
  onClose: () => void
}

/** Item details: the right-hand panel on desktop, a sheet on mobile. */
export function MediaDetails({ item, actions }: { item: MediaItem; actions: DetailsActions }) {
  const [full, setFull] = useState<MediaItem>(item)
  useEffect(() => {
    setFull(item)
    api.mediaItem(item.id).then(setFull, () => undefined)
  }, [item])

  const rows: [string, React.ReactNode][] = [
    ['Type', `${full.kind === 'video' ? 'Video' : 'Audio'} · ${full.ext?.toUpperCase() ?? '–'}`],
    ['Size', formatBytes(full.size)],
    ['Duration', formatDuration(full.duration)],
    ...(full.kind === 'video' && full.height ? ([['Resolution', `${full.width}×${full.height}`]] as [string, string][]) : []),
    ['Codecs', [full.vcodec, full.acodec].filter((c) => c && c !== 'none').join(' + ') || '–'],
    ['Source', full.source ?? '–'],
    ['Added', formatDate(full.created_at)],
    ['Played', full.play_count ? `${full.play_count}×${full.last_played_at ? `, last ${formatDate(full.last_played_at)}` : ''}` : 'Never'],
    ['Subtitles', full.subtitles.length ? full.subtitles.map((s) => s.lang).join(', ') : 'None'],
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="text-[12px] font-medium uppercase tracking-wide text-fg-3">Details</span>
        <IconButton label="Close details" size="sm" onClick={actions.onClose} className="-mr-2">
          <X size={16} />
        </IconButton>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-5 pb-5">
        <button onClick={actions.onPlay} className="group relative mt-3 block w-full" aria-label="Play">
          <Thumb item={full} className={full.kind === 'audio' ? 'aspect-square w-full' : 'aspect-video w-full'} rounded="rounded-lg" iconSize={36} />
          <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/25 opacity-0 transition group-hover:opacity-100">
            <Play size={30} className="fill-white text-white" />
          </span>
        </button>
        <h2 className="mt-4 text-[15px] font-semibold leading-snug">{full.title}</h2>
        {full.uploader && <p className="mt-0.5 text-[13px] text-fg-2">{full.uploader}</p>}
        {full.status === 'missing' && (
          <Badge tone="danger" className="mt-2">
            File missing on disk
          </Badge>
        )}
        <div className="mt-4 flex gap-2">
          <Button variant="primary" icon={<Play size={16} />} onClick={actions.onPlay} disabled={full.status === 'missing'} className="flex-1">
            Play
          </Button>
          <IconButton label={full.favorite ? 'Remove from favorites' : 'Add to favorites'} active={full.favorite} onClick={() => toggleFavorite(full, (m) => { setFull(m); actions.onChanged(m) })}>
            <Heart size={18} className={full.favorite ? 'fill-accent' : ''} />
          </IconButton>
          <IconButton label={saveItemLabel()} onClick={() => saveItem(full)} disabled={full.status === 'missing'}>
            <Download size={18} />
          </IconButton>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" icon={<ListPlus size={15} />} onClick={actions.onAddToPlaylist}>
            Add to playlist
          </Button>
          <Button size="sm" variant="outline" icon={<Pencil size={15} />} onClick={actions.onRename}>
            Rename
          </Button>
          {full.kind === 'video' && (
            <>
              <Button size="sm" variant="outline" icon={<Headphones size={15} />} onClick={() => listenToItem(full)} disabled={full.status === 'missing'}>
                Play as audio
              </Button>
              <Button size="sm" variant="outline" icon={<Music size={15} />} onClick={() => saveAudio(full)} disabled={full.status === 'missing'}>
                Save MP3
              </Button>
            </>
          )}
        </div>

        <dl className="mt-5 divide-y divide-line text-[12.5px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2">
              <dt className="text-fg-3">{k}</dt>
              <dd className="text-right text-fg tabular">{v}</dd>
            </div>
          ))}
          {full.playlists && full.playlists.length > 0 && (
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-fg-3">Playlists</dt>
              <dd className="text-right">{full.playlists.map((p) => p.name).join(', ')}</dd>
            </div>
          )}
        </dl>

        <div className="mt-4 rounded-md bg-surface-2 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-3">File location</p>
          <p className="mt-1 break-all font-mono text-[11.5px] text-fg-2">
            {full.folder}
            {full.folder.includes('\\') ? '\\' : '/'}
            {full.filename}
          </p>
          <button
            onClick={() =>
              navigator.clipboard?.writeText(`${full.folder}${full.folder.includes('\\') ? '\\' : '/'}${full.filename}`).then(() => toast({ tone: 'success', title: 'Path copied' }))
            }
            className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-fg-2 hover:text-fg"
          >
            <Copy size={13} /> Copy path
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {full.source_url && (
            <>
              <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => window.open(full.source_url!, '_blank', 'noopener,noreferrer')}>
                Open source
              </Button>
              <Button size="sm" variant="ghost" icon={<Share2 size={14} />} onClick={() => shareItem(full)}>
                Share link
              </Button>
            </>
          )}
          <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={actions.onDelete} className="ml-auto">
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
