import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy as CopyIcon, FolderSearch, HardDrive, RefreshCw, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/layout/Logo'
import { Button } from '../../components/ui/Button'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback'
import { Thumb } from '../../components/ui/Thumb'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatBytes, formatRelative, plural } from '../../lib/format'
import type { MediaItem, StorageInfo } from '../../lib/types'
import { toast, toastError, useUi } from '../../stores/ui'
import { DeleteDialog } from '../library/dialogs'

export function StoragePage() {
  const [data, setData] = useState<StorageInfo | null>(null)
  const [dupes, setDupes] = useState<{ reason: string; items: MediaItem[] }[]>([])
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<MediaItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const version = useUi((s) => s.libraryVersion)
  const navigate = useNavigate()

  const load = useCallback(() => {
    Promise.all([api.storage(), api.duplicates()]).then(
      ([s, d]) => {
        setData(s)
        setDupes(d.groups)
        setError('')
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])
  useEffect(load, [load, version])

  const rescan = async () => {
    setBusy('rescan')
    try {
      const r = await api.rescan()
      toast({ tone: 'success', title: 'Library rescanned', body: `${r.imported} imported · ${r.missing} missing · ${r.restored} restored` })
      useUi.getState().bumpLibrary()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }
  const cleanTemp = async () => {
    setBusy('temp')
    try {
      const r = await api.cleanupTemp()
      toast({ tone: 'success', title: `Removed ${plural(r.removed, 'temporary folder')}` })
      load()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <div className="p-8"><ErrorState message={error} onRetry={load} /></div>

  const video = data?.by_kind.video ?? { count: 0, size: 0 }
  const audio = data?.by_kind.audio ?? { count: 0, size: 0 }
  const total = data?.total_size ?? 0
  const disk = data?.disk

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const largeSelected = (data?.largest ?? []).filter((i) => selected.has(i.id))

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Storage"
        subtitle={data ? `${formatBytes(total)} across ${plural(data.total_count, 'file')}` : ' '}
        actions={
          <Button size="sm" variant="ghost" icon={<RefreshCw size={15} />} loading={busy === 'rescan'} onClick={rescan}>
            Rescan
          </Button>
        }
      />
      <div className="space-y-6 px-4 pb-10 md:px-8">
        {/* Usage */}
        <section className="rounded-xl bg-surface-1 p-5 ring-1 ring-line">
          {!data ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[28px] font-semibold tracking-tight tabular">{formatBytes(total)}</p>
                {disk && <p className="text-[12.5px] text-fg-2 tabular">{formatBytes(disk.free)} free of {formatBytes(disk.total)} on this drive</p>}
              </div>
              {disk && (
                <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label="Disk usage breakdown">
                  <div className="bg-accent" style={{ width: `${(video.size / disk.total) * 100}%` }} />
                  <div className="bg-info" style={{ width: `${(audio.size / disk.total) * 100}%` }} />
                  <div className="bg-fg-3/40" style={{ width: `${(Math.max(0, disk.used - total) / disk.total) * 100}%` }} />
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Legend color="bg-accent" label="Videos" value={formatBytes(video.size)} sub={plural(video.count, 'file')} />
                <Legend color="bg-info" label="Audio" value={formatBytes(audio.size)} sub={plural(audio.count, 'file')} />
                {disk && <Legend color="bg-fg-3/40" label="Other data" value={formatBytes(Math.max(0, disk.used - total))} sub="Not managed by VidBuddy" />}
                {disk && <Legend color="bg-surface-3" label="Free" value={formatBytes(disk.free)} sub={`${Math.round((disk.free / disk.total) * 100)}%`} />}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[12px] text-fg-3">
                <FolderSearch size={14} />
                <span className="break-all font-mono">{data.media_root}</span>
                <button
                  onClick={() => navigator.clipboard?.writeText(data.media_root).then(() => toast({ tone: 'success', title: 'Path copied' }))}
                  className="flex items-center gap-1 font-medium text-fg-2 hover:text-fg"
                >
                  <CopyIcon size={12} /> Copy
                </button>
                {data.missing > 0 && <Badge tone="danger">{plural(data.missing, 'missing file')}</Badge>}
                {data.temp_jobs > 0 && (
                  <button onClick={cleanTemp} className="ml-auto font-medium text-fg-2 hover:text-fg">
                    {busy === 'temp' ? 'Cleaning…' : `Clean temporary files (${data.temp_jobs})`}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        {data && data.by_source.length > 0 && (
          <section>
            <h2 className="mb-3 text-[13px] font-semibold text-fg-2">By source</h2>
            <div className="space-y-2 rounded-xl bg-surface-1 p-4 ring-1 ring-line">
              {data.by_source.map((s) => (
                <div key={s.source} className="flex items-center gap-3 text-[13px]">
                  <span className="w-28 truncate">{s.source}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-fg-2" style={{ width: `${total ? (s.size / total) * 100 : 0}%` }} />
                  </div>
                  <span className="w-20 text-right text-fg-2 tabular">{formatBytes(s.size)}</span>
                  <span className="hidden w-16 text-right text-[12px] text-fg-3 tabular sm:block">{s.count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Largest files */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-fg-2">Largest files</h2>
            {largeSelected.length > 0 && (
              <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => setDeleting(largeSelected)}>
                Delete {largeSelected.length} · {formatBytes(largeSelected.reduce((a, b) => a + b.size, 0))}
              </Button>
            )}
          </div>
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.largest.length === 0 ? (
            <EmptyState icon={<HardDrive size={22} />} title="Nothing stored yet" body="Downloads will show up here with their sizes." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface-1 ring-1 ring-line">
              {data.largest.map((m) => (
                <li key={m.id} className={cn('flex items-center gap-3 px-4 py-2.5', selected.has(m.id) && 'bg-accent-soft')}>
                  <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.title}`} className="size-4 accent-[var(--accent)]" />
                  <Thumb item={m} className={m.kind === 'audio' ? 'size-10' : 'aspect-video w-16'} showDuration={false} iconSize={14} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/library?item=${m.id}`)}>
                    <p className="truncate text-[13px] font-medium">{m.title}</p>
                    <p className="truncate text-[12px] text-fg-3">
                      {m.ext?.toUpperCase()} · {formatRelative(m.created_at)}
                    </p>
                  </button>
                  <span className="text-[13px] font-medium tabular">{formatBytes(m.size)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Duplicates */}
        <section>
          <h2 className="mb-1 text-[13px] font-semibold text-fg-2">Possible duplicates</h2>
          <p className="mb-3 text-[12.5px] text-fg-3">
            {dupes.length ? `${plural(dupes.length, 'group')}${data?.reclaimable ? `, ${formatBytes(data.reclaimable)} reclaimable from identical copies` : ''}` : 'No duplicates found.'}
          </p>
          <div className="space-y-3">
            {dupes.map((g, gi) => (
              <div key={gi} className="rounded-xl bg-surface-1 ring-1 ring-line">
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <Badge tone={g.reason === 'identical file' ? 'danger' : 'info'}>{g.reason === 'identical file' ? 'Identical file' : 'Same source'}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(g.items.slice(1))}>
                    Keep oldest, delete {g.items.length - 1}
                  </Button>
                </div>
                <ul className="divide-y divide-line">
                  {g.items.map((m, i) => (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                      <Thumb item={m} className="aspect-video w-14" showDuration={false} iconSize={12} />
                      <span className="min-w-0 flex-1 truncate">{m.filename}</span>
                      {i === 0 && <Badge>Oldest</Badge>}
                      <span className="text-fg-3 tabular">{formatBytes(m.size)}</span>
                      <button aria-label={`Delete ${m.filename}`} onClick={() => setDeleting([m])} className="rounded p-1 text-fg-3 hover:text-danger">
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
      <DeleteDialog
        items={deleting}
        onClose={() => setDeleting([])}
        onDone={() => {
          setSelected(new Set())
          load()
        }}
      />
    </div>
  )
}

function Legend({ color, label, value, sub }: { color: string; label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[12px] text-fg-2">
        <span className={cn('size-2 rounded-full', color)} />
        {label}
      </p>
      <p className="mt-0.5 text-[15px] font-semibold tabular">{value}</p>
      <p className="text-[11.5px] text-fg-3">{sub}</p>
    </div>
  )
}
