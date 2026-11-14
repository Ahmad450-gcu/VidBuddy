import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Check, ChevronDown, Download, ExternalLink, Film, Music2, Play, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Chip, Field, Segmented, Select, Switch } from '../../components/ui/Controls'
import { Dialog } from '../../components/ui/Dialog'
import { Badge } from '../../components/ui/Feedback'
import { Thumb } from '../../components/ui/Thumb'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatBytes, formatCount, formatDuration } from '../../lib/format'
import type { AudioFormat, Container, MediaAnalysis, MediaKind } from '../../lib/types'
import { useDownloads } from '../../stores/downloads'
import { usePrefs } from '../../stores/prefs'
import { toast, toastError } from '../../stores/ui'
import { estimateSize, initialSelection, LOSSLESS, toOptions, type Selection } from './selection'

type Tab = MediaKind | 'advanced'

export function MediaOptions({ data, onQueued }: { data: MediaAnalysis; onQueued: () => void }) {
  const prefs = usePrefs((s) => s.prefs)
  const [sel, setSel] = useState<Selection>(() => initialSelection(data, prefs))
  const [tab, setTab] = useState<Tab>(sel.kind)
  const [busy, setBusy] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [priorityTop, setPriorityTop] = useState(false)
  const navigate = useNavigate()
  const upsert = useDownloads((s) => s.upsert)
  const update = (patch: Partial<Selection>) => setSel((s) => ({ ...s, ...patch }))
  const size = useMemo(() => estimateSize(data, sel), [data, sel])
  const existing = data.existing?.[sel.kind]
  const subtitleLangs = useMemo(
    () => [...new Set([...data.subtitles.manual, ...data.subtitles.automatic])],
    [data.subtitles],
  )

  const queue = async (scheduledAt?: number) => {
    setBusy(true)
    try {
      const res = await api.createDownload({
        url: data.url,
        title: data.title,
        thumbnail: data.thumbnail,
        kind: sel.kind,
        options: toOptions(sel, prefs),
        priority: priorityTop ? 5 : 0,
        scheduled_at: scheduledAt ?? null,
      })
      res.items.forEach(upsert)
      toast({
        tone: 'success',
        title: scheduledAt ? 'Download scheduled' : 'Added to downloads',
        body: data.title,
        action: { label: 'View', run: () => navigate('/downloads') },
      })
      onQueued()
    } catch (e) {
      toastError(e, "Couldn't start the download")
    } finally {
      setBusy(false)
    }
  }

  const tabs = [
    { value: 'video' as const, label: <><Film size={14} /> Video</>, disabled: !data.presets.has_video },
    { value: 'audio' as const, label: <><Music2 size={14} /> Audio</>, disabled: !data.presets.has_audio },
    { value: 'advanced' as const, label: <><SlidersHorizontal size={14} /> All formats</> },
  ]

  return (
    <section aria-label="Download options" className="overflow-hidden rounded-xl bg-surface-1 ring-1 ring-line animate-rise">
      {/* Media header */}
      <div className="flex gap-4 p-4 md:p-5">
        <Thumb src={data.thumbnail} duration={data.duration} kind={data.presets.has_video ? 'video' : 'audio'} className="aspect-video w-32 sm:w-48" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">{data.source.name}</Badge>
            {data.cached && <Badge>Cached</Badge>}
          </div>
          <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug md:text-base">{data.title}</h2>
          <p className="mt-1 truncate text-[13px] text-fg-2">
            {[data.uploader, data.duration ? formatDuration(data.duration) : null, data.view_count ? `${formatCount(data.view_count)} views` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <a href={data.url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-[12px] text-fg-3 hover:text-fg-2">
            {data.source.domain} <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {existing && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-md bg-info-soft px-3 py-2 text-[12.5px] text-info md:mx-5">
          <span>This is already in your library as {sel.kind}.</span>
          <button
            className="flex items-center gap-1 font-semibold"
            onClick={() => (existing.kind === 'video' ? navigate(`/watch/${existing.id}`) : navigate(`/library?view=audio&item=${existing.id}`))}
          >
            <Play size={13} /> Open
          </button>
        </div>
      )}

      <div className="border-t border-line px-4 py-4 md:px-5">
        <Segmented
          ariaLabel="Download type"
          value={tab}
          onChange={(t) => {
            setTab(t)
            if (t !== 'advanced') update({ kind: t, quality: t === 'video' && sel.quality.startsWith('fmt:') ? 'best' : sel.quality })
          }}
          options={tabs}
          className="w-full sm:w-auto"
        />

        <div className="mt-4">
          {tab === 'video' && <VideoPanel data={data} sel={sel} update={update} subtitleLangs={subtitleLangs} />}
          {tab === 'audio' && <AudioPanel data={data} sel={sel} update={update} />}
          {tab === 'advanced' && <AdvancedPanel data={data} sel={sel} update={update} />}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-surface-1 px-4 py-3 md:px-5">
        <div className="w-full text-[12.5px] text-fg-2 sm:mr-auto sm:w-auto">
          <span className="font-medium text-fg">{sel.kind === 'audio' ? sel.audioFormat.toUpperCase() : sel.container.toUpperCase()}</span>
          {' · '}
          {size ? `≈ ${formatBytes(size)}` : 'size unknown'}
        </div>
        <label className="mr-auto flex items-center gap-2 text-[12.5px] text-fg-2 sm:mr-0">
          <input type="checkbox" checked={priorityTop} onChange={(e) => setPriorityTop(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Jump the queue
        </label>
        <Button variant="ghost" size="md" icon={<CalendarClock size={16} />} onClick={() => setScheduleOpen(true)}>
          Later
        </Button>
        <Button variant="primary" size="md" icon={<Download size={16} />} loading={busy} onClick={() => queue()} className="w-full sm:w-auto">
          Download
        </Button>
      </footer>
      <ScheduleDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} onSchedule={(t) => queue(t)} />
    </section>
  )
}

function VideoPanel({ data, sel, update, subtitleLangs }: { data: MediaAnalysis; sel: Selection; update: (p: Partial<Selection>) => void; subtitleLangs: string[] }) {
  const best = data.presets.video[0]
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-[12px] font-medium text-fg-2">Quality</h3>
        <div className="flex flex-wrap gap-2">
          <Chip selected={sel.quality === 'best'} onClick={() => update({ quality: 'best' })} sub={best?.size_estimate ? formatBytes(best.size_estimate) : best?.label}>
            Best
          </Chip>
          {data.presets.video.filter((v) => v.id !== 'best').map((v) => (
            <Chip key={v.id} selected={sel.quality === v.id} onClick={() => update({ quality: v.id })} sub={v.size_estimate ? formatBytes(v.size_estimate) : v.codecs.join(' / ') || '–'}>
              {v.label}
              {v.hdr && <span className="ml-1 text-[10px] text-info">HDR</span>}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <h3 className="mb-2 text-[12px] font-medium text-fg-2">Format</h3>
          <Segmented<Container>
            ariaLabel="Container"
            size="sm"
            value={sel.container}
            onChange={(container) => update({ container })}
            options={[
              { value: 'mp4', label: 'MP4', hint: 'Plays everywhere (H.264 preferred)' },
              { value: 'webm', label: 'WebM', hint: 'VP9 / Opus' },
              { value: 'mkv', label: 'MKV', hint: 'Highest quality codecs, any combination' },
            ]}
          />
        </div>
        {subtitleLangs.length > 0 && (
          <div className="flex min-w-60 flex-1 items-center gap-3">
            <div className="flex-1">
              <Switch
                checked={sel.subtitles}
                onChange={(subtitles) => update({ subtitles })}
                label="Subtitles"
                description={data.subtitles.manual.includes(sel.subtitleLang) ? 'Creator-provided' : 'Auto-generated'}
              />
            </div>
            {sel.subtitles && (
              <Select
                aria-label="Subtitle language"
                value={sel.subtitleLang}
                onChange={(e) => update({ subtitleLang: e.target.value, autoSubtitles: !data.subtitles.manual.includes(e.target.value) })}
                className="w-28"
              >
                {subtitleLangs.map((l) => (
                  <option key={l} value={l}>
                    {l}
                    {data.subtitles.manual.includes(l) ? '' : ' (auto)'}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AudioPanel({ data, sel, update }: { data: MediaAnalysis; sel: Selection; update: (p: Partial<Selection>) => void }) {
  const lossless = LOSSLESS.includes(sel.audioFormat)
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-[12px] font-medium text-fg-2">Format</h3>
        <div className="flex flex-wrap gap-2">
          {data.presets.audio.targets.map((t) => (
            <Chip key={t.id} selected={sel.audioFormat === t.id} onClick={() => update({ audioFormat: t.id as AudioFormat })} sub={t.lossy ? 'Compressed' : 'Lossless'}>
              {t.label}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-[12px] font-medium text-fg-2">
          Bitrate
          {data.presets.audio.source_abr && (
            <span className="font-normal text-fg-3">Source is ~{Math.round(data.presets.audio.source_abr)} kbps {data.presets.audio.source_codec?.split('.')[0]}</span>
          )}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Chip selected={lossless || sel.audioBitrate === 0} disabled={lossless} onClick={() => update({ audioBitrate: 0 })} sub="VBR">
            Best
          </Chip>
          {data.presets.audio.bitrates.map((b) => (
            <Chip key={b} selected={!lossless && sel.audioBitrate === b} disabled={lossless} onClick={() => update({ audioBitrate: b })} sub="kbps">
              {b}
            </Chip>
          ))}
        </div>
      </div>
      <Switch
        checked={sel.embedThumbnail && !['wav', 'aac'].includes(sel.audioFormat)}
        disabled={['wav', 'aac'].includes(sel.audioFormat)}
        onChange={(embedThumbnail) => update({ embedThumbnail })}
        label="Embed artwork"
        description={['wav', 'aac'].includes(sel.audioFormat) ? `${sel.audioFormat.toUpperCase()} files can't hold artwork` : 'Cover art and tags are written into the file'}
      />
    </div>
  )
}

function AdvancedPanel({ data, sel, update }: { data: MediaAnalysis; sel: Selection; update: (p: Partial<Selection>) => void }) {
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(
    () =>
      [...data.formats].sort(
        (a, b) => Number(b.has_video) - Number(a.has_video) || (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? b.abr ?? 0) - (a.tbr ?? a.abr ?? 0),
      ),
    [data.formats],
  )
  const visible = showAll ? rows : rows.slice(0, 12)
  return (
    <div>
      <p className="mb-3 text-[12.5px] text-fg-3">Pick an exact stream. Video-only streams are merged with the best audio automatically.</p>
      <div className="scrollbar-thin overflow-x-auto rounded-md ring-1 ring-line">
        <table className="w-full min-w-[560px] text-left text-[12.5px] tabular">
          <thead className="bg-surface-2 text-fg-3">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-2 py-2 font-medium">ID</th>
              <th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2 font-medium">Resolution</th>
              <th className="px-2 py-2 font-medium">Codec</th>
              <th className="px-2 py-2 font-medium">Bitrate</th>
              <th className="px-2 py-2 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => {
              const id = `fmt:${f.format_id}`
              const selected = sel.quality === id
              return (
                <tr
                  key={f.format_id}
                  onClick={() => update({ quality: id, kind: f.has_video ? 'video' : 'audio' })}
                  className={cn('cursor-pointer border-t border-line', selected ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                >
                  <td className="px-3 py-2">{selected && <Check size={14} className="text-accent" />}</td>
                  <td className="px-2 py-2 font-mono text-fg-2">{f.format_id}</td>
                  <td className="px-2 py-2">
                    {f.has_video && f.has_audio ? 'Video + audio' : f.has_video ? 'Video only' : 'Audio only'}
                    <span className="ml-1 text-fg-3">{f.ext}</span>
                  </td>
                  <td className="px-2 py-2">{f.height ? `${f.width ?? '?'}×${f.height}${f.fps ? ` ${Math.round(f.fps)}fps` : ''}` : '–'}</td>
                  <td className="max-w-[140px] truncate px-2 py-2 text-fg-2">{[f.vcodec, f.acodec].filter(Boolean).join(' + ') || '–'}</td>
                  <td className="px-2 py-2 text-fg-2">{f.tbr ? `${Math.round(f.tbr)}k` : f.abr ? `${Math.round(f.abr)}k` : '–'}</td>
                  <td className="px-2 py-2 text-right">{f.filesize ? `${f.exact_size ? '' : '≈'}${formatBytes(f.filesize)}` : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 12 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 flex items-center gap-1 text-[12.5px] font-medium text-fg-2 hover:text-fg">
          <ChevronDown size={14} className={cn('transition-transform', showAll && 'rotate-180')} />
          {showAll ? 'Show fewer' : `Show all ${rows.length} formats`}
        </button>
      )}
    </div>
  )
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ScheduleDialog({ open, onClose, onSchedule }: { open: boolean; onClose: () => void; onSchedule: (epochSeconds: number) => void }) {
  const tonight = new Date()
  tonight.setHours(tonight.getHours() < 23 ? 23 : tonight.getHours() + 1, 0, 0, 0)
  const [value, setValue] = useState(toLocalInput(tonight))
  const ts = new Date(value).getTime()
  const valid = Number.isFinite(ts) && ts > Date.now()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Schedule download"
      description="VidBuddy will start it automatically at this time. The server must be running."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              onSchedule(Math.floor(ts / 1000))
              onClose()
            }}
          >
            Schedule
          </Button>
        </>
      }
    >
      <Field label="Start at" hint={valid ? undefined : 'Pick a time in the future.'}>
        <input
          type="datetime-local"
          value={value}
          min={toLocalInput(new Date())}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 w-full rounded-md bg-surface-2 px-3 text-sm text-fg outline-none ring-1 ring-inset ring-transparent focus:ring-accent"
        />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        {[
          ['In 1 hour', 1],
          ['Tonight', 0],
          ['Tomorrow 8:00', -1],
        ].map(([label, h]) => (
          <button
            key={label}
            onClick={() => {
              const d = new Date()
              if (h === 1) d.setHours(d.getHours() + 1)
              else if (h === 0) d.setTime(tonight.getTime())
              else {
                d.setDate(d.getDate() + 1)
                d.setHours(8, 0, 0, 0)
              }
              setValue(toLocalInput(d))
            }}
            className="rounded-full bg-surface-2 px-3 py-1 text-[12.5px] text-fg-2 hover:text-fg"
          >
            {label}
          </button>
        ))}
      </div>
    </Dialog>
  )
}
