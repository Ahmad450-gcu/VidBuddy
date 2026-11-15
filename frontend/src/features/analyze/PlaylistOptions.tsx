import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Film, ListVideo, Music2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Segmented, Select } from '../../components/ui/Controls'
import { Badge } from '../../components/ui/Feedback'
import { Thumb } from '../../components/ui/Thumb'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatDuration, plural } from '../../lib/format'
import type { AudioFormat, MediaKind, PlaylistAnalysis } from '../../lib/types'
import { useDownloads } from '../../stores/downloads'
import { usePrefs } from '../../stores/prefs'
import { toast, toastError } from '../../stores/ui'
import { useAnalysis } from './analysisStore'

const QUALITIES = [
  ['best', 'Best available'],
  ['h2160', 'Up to 4K'],
  ['h1440', 'Up to 1440p'],
  ['h1080', 'Up to 1080p'],
  ['h720', 'Up to 720p'],
  ['h480', 'Up to 480p'],
  ['h360', 'Up to 360p'],
] as const
const AUDIO: AudioFormat[] = ['mp3', 'm4a', 'opus', 'aac', 'flac', 'wav']

export function PlaylistOptions({ data, onQueued }: { data: PlaylistAnalysis; onQueued: () => void }) {
  const prefs = usePrefs((s) => s.prefs)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(data.entries.map((e) => e.index)))
  const [kind, setKind] = useState<MediaKind>(prefs.default_kind)
  const [quality, setQuality] = useState<string>(prefs.default_quality)
  const [audioFormat, setAudioFormat] = useState<AudioFormat>(prefs.default_audio_format)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const upsert = useDownloads((s) => s.upsert)
  const navigate = useNavigate()

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? data.entries.filter((e) => e.title.toLowerCase().includes(q)) : data.entries
  }, [data.entries, filter])
  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.has(e.index))
  const totalDuration = data.entries.filter((e) => selected.has(e.index)).reduce((s, e) => s + (e.duration ?? 0), 0)

  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  const queue = async () => {
    const entries = data.entries.filter((e) => selected.has(e.index))
    if (!entries.length) return
    setBusy(true)
    try {
      const res = await api.createDownload({
        kind,
        entries: entries.map((e) => ({ url: e.url, title: e.title, thumbnail: e.thumbnail })),
        playlist_title: data.title,
        headers: useAnalysis.getState().analyzedHeaders || undefined,
        options: {
          quality: kind === 'video' ? quality : 'best',
          container: prefs.default_container,
          audio_format: audioFormat,
          audio_bitrate: ['flac', 'wav'].includes(audioFormat) ? 0 : prefs.default_audio_bitrate,
          embed_metadata: prefs.embed_metadata,
          embed_thumbnail: prefs.embed_thumbnail,
          filename_template: prefs.filename_template,
        },
      })
      res.items.forEach(upsert)
      toast({ tone: 'success', title: `${plural(res.items.length, 'item')} queued`, body: data.title, action: { label: 'View', run: () => navigate('/downloads') } })
      onQueued()
    } catch (e) {
      toastError(e, "Couldn't queue the playlist")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Playlist" className="overflow-hidden rounded-xl bg-surface-1 ring-1 ring-line animate-rise">
      <div className="flex gap-4 p-4 md:p-5">
        <div className="relative">
          <Thumb src={data.thumbnail} className="aspect-video w-32 sm:w-44" showDuration={false} />
          <span className="absolute inset-y-0 right-0 flex w-12 flex-col items-center justify-center gap-0.5 rounded-r-md bg-black/70 text-[11px] font-semibold text-white">
            <ListVideo size={16} />
            {data.entry_count}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex gap-1.5">
            <Badge tone="accent">{data.source.name}</Badge>
            <Badge>Playlist</Badge>
          </div>
          <h2 className="line-clamp-2 text-[15px] font-semibold md:text-base">{data.title}</h2>
          <p className="mt-1 text-[13px] text-fg-2">{[data.uploader, plural(data.entry_count, 'item')].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 md:px-5">
        <Segmented<MediaKind>
          ariaLabel="Download type"
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'video', label: <><Film size={13} /> Video</> },
            { value: 'audio', label: <><Music2 size={13} /> Audio</> },
          ]}
        />
        {kind === 'video' ? (
          <Select aria-label="Quality" value={quality} onChange={(e) => setQuality(e.target.value)} className="w-40">
            {QUALITIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        ) : (
          <Select aria-label="Audio format" value={audioFormat} onChange={(e) => setAudioFormat(e.target.value as AudioFormat)} className="w-32">
            {AUDIO.map((a) => (
              <option key={a} value={a}>
                {a.toUpperCase()}
              </option>
            ))}
          </Select>
        )}
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter items"
          aria-label="Filter playlist items"
          className="h-8 min-w-0 flex-1 rounded-md bg-surface-2 px-3 text-[13px] outline-none ring-1 ring-inset ring-transparent focus:ring-accent sm:max-w-56"
        />
      </div>

      <div className="flex items-center justify-between border-t border-line bg-surface-2/40 px-4 py-2 text-[12.5px] md:px-5">
        <label className="flex items-center gap-2.5 text-fg-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={allVisibleSelected}
            onChange={() =>
              setSelected((s) => {
                const n = new Set(s)
                visible.forEach((e) => (allVisibleSelected ? n.delete(e.index) : n.add(e.index)))
                return n
              })
            }
          />
          {allVisibleSelected ? 'Deselect all' : 'Select all'}
        </label>
        <span className="text-fg-3 tabular">
          {selected.size} of {data.entries.length} selected{totalDuration ? ` · ${formatDuration(totalDuration)}` : ''}
        </span>
      </div>

      <ul className="scrollbar-thin max-h-[420px] overflow-y-auto">
        {visible.map((e) => (
          <li key={e.index}>
            <label className={cn('flex cursor-pointer items-center gap-3 border-t border-line px-4 py-2 md:px-5', selected.has(e.index) ? '' : 'opacity-60')}>
              <input type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={selected.has(e.index)} onChange={() => toggle(e.index)} />
              <span className="w-6 shrink-0 text-right text-[12px] text-fg-3 tabular">{e.index}</span>
              <Thumb src={e.thumbnail} duration={e.duration} className="aspect-video w-20" iconSize={16} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13px] text-fg">{e.title}</span>
                {e.uploader && <span className="block truncate text-[12px] text-fg-3">{e.uploader}</span>}
              </span>
            </label>
          </li>
        ))}
        {!visible.length && <li className="border-t border-line px-5 py-8 text-center text-[13px] text-fg-3">No items match "{filter}".</li>}
      </ul>

      <footer className="flex items-center justify-end gap-3 border-t border-line px-4 py-3 md:px-5">
        <Button variant="primary" icon={<Download size={16} />} disabled={!selected.size} loading={busy} onClick={queue}>
          Download {selected.size ? plural(selected.size, 'item') : ''}
        </Button>
      </footer>
    </section>
  )
}
