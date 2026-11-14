import { useEffect, useState } from 'react'
import { Check, ListPlus, Plus } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Field, Input, Switch } from '../../components/ui/Controls'
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog'
import { Spinner } from '../../components/ui/Feedback'
import { api } from '../../lib/api'
import { formatBytes, plural } from '../../lib/format'
import type { MediaItem, Playlist } from '../../lib/types'
import { toast, toastError, useUi } from '../../stores/ui'

export function RenameDialog({ item, onClose, onDone }: { item: MediaItem | null; onClose: () => void; onDone?: (m: MediaItem) => void }) {
  const [title, setTitle] = useState('')
  const [renameFile, setRenameFile] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (item) setTitle(item.title)
  }, [item])
  const submit = async () => {
    if (!item || !title.trim()) return
    setBusy(true)
    try {
      const m = await api.patchMedia(item.id, { title: title.trim(), rename_file: renameFile })
      toast({ tone: 'success', title: 'Renamed' })
      onDone?.(m)
      onClose()
    } catch (e) {
      toastError(e, "Couldn't rename")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title="Rename"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || title.trim() === item?.title} onClick={submit}>
            Rename
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="space-y-3"
      >
        <Field label="Title">
          <Input autoFocus value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Switch checked={renameFile} onChange={setRenameFile} label="Rename the file on disk too" description={item ? `Currently ${item.filename}` : undefined} />
      </form>
    </Dialog>
  )
}

export function DeleteDialog({ items, onClose, onDone }: { items: MediaItem[]; onClose: () => void; onDone?: () => void }) {
  const [deleteFile, setDeleteFile] = useState(true)
  const size = items.reduce((s, i) => s + i.size, 0)
  return (
    <ConfirmDialog
      open={items.length > 0}
      onClose={onClose}
      danger
      title={items.length === 1 ? `Delete "${items[0].title}"?` : `Delete ${plural(items.length, 'item')}?`}
      body={deleteFile ? `${formatBytes(size)} will be freed. This can't be undone.` : 'Items are removed from the library; files stay on disk.'}
      confirmLabel="Delete"
      onConfirm={async () => {
        try {
          await api.bulkDelete(items.map((i) => i.id), deleteFile)
          toast({ tone: 'success', title: items.length === 1 ? 'Deleted' : `Deleted ${plural(items.length, 'item')}` })
          useUi.getState().bumpLibrary()
          onDone?.()
        } catch (e) {
          toastError(e, "Couldn't delete")
        }
      }}
    >
      <Switch checked={deleteFile} onChange={setDeleteFile} label="Also delete files from disk" />
    </ConfirmDialog>
  )
}

export function AddToPlaylistDialog({ items, onClose }: { items: MediaItem[]; onClose: () => void }) {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const open = items.length > 0
  useEffect(() => {
    if (!open) return
    setAdded(new Set())
    setName('')
    api.playlists().then((r) => setPlaylists(r.items), () => setPlaylists([]))
  }, [open])

  const add = async (p: Playlist) => {
    setBusy(p.id)
    try {
      await api.addToPlaylist(p.id, items.map((i) => i.id))
      setAdded((s) => new Set(s).add(p.id))
      toast({ tone: 'success', title: `Added to ${p.name}` })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }
  const create = async () => {
    if (!name.trim()) return
    setBusy('new')
    try {
      const p = await api.createPlaylist(name.trim(), items.map((i) => i.id))
      toast({ tone: 'success', title: `Created ${p.name}` })
      onClose()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add to playlist" description={items.length > 1 ? plural(items.length, 'item') : items[0]?.title}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
        className="mb-3 flex gap-2"
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist name" maxLength={120} className="flex-1" aria-label="New playlist name" />
        <Button type="submit" variant="primary" icon={<Plus size={16} />} loading={busy === 'new'} disabled={!name.trim()}>
          Create
        </Button>
      </form>
      {playlists === null ? (
        <div className="grid place-items-center py-6 text-fg-3">
          <Spinner />
        </div>
      ) : playlists.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-fg-3">No playlists yet. Name one above.</p>
      ) : (
        <ul className="-mx-2 pb-2">
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => add(p)}
                disabled={busy === p.id || added.has(p.id)}
                className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-surface-2 disabled:hover:bg-transparent"
              >
                <span className="grid size-8 place-items-center rounded-md bg-surface-3 text-fg-2">
                  {added.has(p.id) ? <Check size={16} className="text-success" /> : busy === p.id ? <Spinner size={14} /> : <ListPlus size={16} />}
                </span>
                <span className="flex-1 truncate text-[13.5px]">{p.name}</span>
                <span className="text-[12px] text-fg-3">{plural(p.count ?? 0, 'item')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
