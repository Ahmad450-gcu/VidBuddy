import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowUp, ListMusic, Pencil, Play, Plus, Shuffle, Trash2, X } from 'lucide-react'
import { PageHeader } from '../../components/layout/Logo'
import { Button, IconButton } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Controls'
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback'
import { Thumb } from '../../components/ui/Thumb'
import { api } from '../../lib/api'
import { formatDuration, plural } from '../../lib/format'
import type { Playlist } from '../../lib/types'
import { usePlayer } from '../../stores/player'
import { toast, toastError, useUi } from '../../stores/ui'
import { playItem } from '../library/actions'

function NameDialog({ open, initial, title, onClose, onSubmit }: { open: boolean; initial?: string; title: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setName(initial ?? '')
  }, [open, initial])
  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Name">
          <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  )
}

export function PlaylistsPage() {
  const [items, setItems] = useState<Playlist[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const version = useUi((s) => s.libraryVersion)
  const navigate = useNavigate()

  const load = useCallback(() => {
    api.playlists().then(
      (r) => setItems(r.items),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])
  useEffect(load, [load, version])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Playlists"
        subtitle={items ? plural(items.length, 'playlist') : ' '}
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            New playlist
          </Button>
        }
      />
      <div className="px-4 pb-10 md:px-8">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !items ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <Skeleton className="aspect-square w-full" />
                <Skeleton className="mt-2 h-3.5 w-2/3" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ListMusic size={22} />}
            title="No playlists yet"
            body="Group videos and audio into playlists. Add items from the library with the ⋯ menu or by multi-selecting."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Create a playlist</Button>}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((p) => (
              <Link key={p.id} to={`/playlists/${p.id}`} className="group rounded-lg p-1.5 hover:bg-surface-1">
                <div className="relative">
                  {p.cover_id ? (
                    <Thumb item={{ id: p.cover_id, has_thumbnail: true, kind: 'audio', duration: null }} className="aspect-square w-full" rounded="rounded-md" />
                  ) : (
                    <div className="grid aspect-square w-full place-items-center rounded-md bg-surface-2 text-fg-3">
                      <ListMusic size={28} strokeWidth={1.5} />
                    </div>
                  )}
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white tabular">{p.count ?? 0}</span>
                </div>
                <p className="mt-2 truncate text-[13.5px] font-medium">{p.name}</p>
                <p className="text-[12px] text-fg-3">
                  {plural(p.count ?? 0, 'item')}
                  {p.duration ? ` · ${formatDuration(p.duration)}` : ''}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
      <NameDialog
        open={creating}
        title="New playlist"
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          const p = await api.createPlaylist(name)
          navigate(`/playlists/${p.id}`)
        }}
      />
    </div>
  )
}

export function PlaylistDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [p, setP] = useState<Playlist | null>(null)
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    api.playlist(id).then(setP, (e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])
  useEffect(load, [load])

  if (error) return <div className="p-8"><ErrorState message={error} onRetry={load} /></div>
  if (!p) return <div className="space-y-3 p-8"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-32" /></div>
  const items = p.items ?? []
  const playable = items.filter((i) => i.status === 'ready')
  const total = items.reduce((s, i) => s + (i.duration ?? 0), 0)

  const playAll = (shuffle = false) => {
    const audio = playable.filter((i) => i.kind === 'audio')
    if (audio.length) {
      const st = usePlayer.getState()
      if (shuffle !== st.shuffle) st.toggleShuffle()
      st.playAudio(audio, shuffle ? Math.floor(Math.random() * audio.length) : 0)
    } else if (playable[0]) playItem(playable[0], playable, navigate)
  }
  const move = async (from: number, to: number) => {
    const order = items.map((i) => i.id)
    const [m] = order.splice(from, 1)
    order.splice(to, 0, m)
    try {
      setP(await api.patchPlaylist(p.id, { order }))
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 md:px-8">
      <Link to="/playlists" className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg md:mt-8">
        <ArrowLeft size={15} /> Playlists
      </Link>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end">
        {items[0] ? <Thumb item={items[0]} className="aspect-square w-36" rounded="rounded-lg" showDuration={false} /> : <div className="grid aspect-square w-36 place-items-center rounded-lg bg-surface-2 text-fg-3"><ListMusic size={32} /></div>}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{p.name}</h1>
          <p className="mt-1 text-[13px] text-fg-2">
            {plural(items.length, 'item')}
            {total ? ` · ${formatDuration(total)}` : ''}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon={<Play size={16} />} disabled={!playable.length} onClick={() => playAll()}>
              Play
            </Button>
            <Button icon={<Shuffle size={16} />} disabled={!playable.some((i) => i.kind === 'audio')} onClick={() => playAll(true)}>
              Shuffle
            </Button>
            <IconButton label="Rename playlist" onClick={() => setRenaming(true)}>
              <Pencil size={17} />
            </IconButton>
            <IconButton label="Delete playlist" onClick={() => setDeleting(true)}>
              <Trash2 size={17} />
            </IconButton>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ListMusic size={22} />}
          title="This playlist is empty"
          body="Add items from your library with ⋯ › Add to playlist."
          action={<Button onClick={() => navigate('/library')}>Open library</Button>}
        />
      ) : (
        <ol className="mt-6 divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
          {items.map((m, i) => (
            <li key={m.id} className="group flex items-center gap-3 bg-surface-1/40 px-3 py-2 hover:bg-surface-1">
              <span className="w-6 text-right text-[12px] text-fg-3 tabular">{i + 1}</span>
              <button onClick={() => playItem(m, playable, navigate)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Thumb item={m} className={m.kind === 'audio' ? 'size-10' : 'aspect-video w-[72px]'} showDuration={false} iconSize={14} />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium">{m.title}</span>
                  <span className="block truncate text-[12px] text-fg-3">
                    {[m.uploader ?? m.source, m.kind === 'video' ? 'Video' : 'Audio', formatDuration(m.duration)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
              <div className="flex opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <IconButton label="Move up" size="sm" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp size={15} />
                </IconButton>
                <IconButton label="Move down" size="sm" disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
                  <ArrowDown size={15} />
                </IconButton>
                <IconButton
                  label="Remove from playlist"
                  size="sm"
                  onClick={async () => {
                    try {
                      setP(await api.removeFromPlaylist(p.id, m.id))
                    } catch (e) {
                      toastError(e)
                    }
                  }}
                >
                  <X size={15} />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>
      )}

      <NameDialog open={renaming} initial={p.name} title="Rename playlist" onClose={() => setRenaming(false)} onSubmit={async (name) => setP(await api.patchPlaylist(p.id, { name }))} />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        danger
        title={`Delete "${p.name}"?`}
        body="The playlist is removed. The media in it stays in your library."
        confirmLabel="Delete playlist"
        onConfirm={async () => {
          await api.deletePlaylist(p.id)
          toast({ tone: 'success', title: 'Playlist deleted' })
          navigate('/playlists')
        }}
      />
    </div>
  )
}
