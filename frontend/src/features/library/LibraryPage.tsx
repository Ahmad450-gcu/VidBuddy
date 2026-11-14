import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  CheckSquare, Download, Film, FolderOpen, Headphones, Heart, Info, LayoutGrid, Library as LibraryIcon, List, ListPlus, Loader2, Music, Music2, Pencil, Play, Search, Trash2, X,
} from 'lucide-react'
import { PageHeader } from '../../components/layout/Logo'
import { Button, IconButton } from '../../components/ui/Button'
import { Input, Segmented, Select } from '../../components/ui/Controls'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback'
import type { MenuItem } from '../../components/ui/Menu'
import { Thumb } from '../../components/ui/Thumb'
import type { MediaQuery } from '../../lib/api'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { plural } from '../../lib/format'
import type { MediaItem } from '../../lib/types'
import { groupJobs, useDownloads } from '../../stores/downloads'
import { usePlayer } from '../../stores/player'
import { toastError } from '../../stores/ui'
import { listenToItem, playItem, saveAudio, saveItem, saveItemLabel, toggleFavorite } from './actions'
import { isDesktop } from '../../lib/platform'
import { AddToPlaylistDialog, DeleteDialog, RenameDialog } from './dialogs'
import { MediaDetails } from './MediaDetails'
import { MediaCard, MediaRow } from './MediaTile'
import { useDebounced, useMediaList } from './useMedia'

type View = 'all' | 'video' | 'audio' | 'favorites' | 'recent'
type Sort = NonNullable<MediaQuery['sort']>

const VIEWS: { value: View; label: React.ReactNode }[] = [
  { value: 'all', label: 'All' },
  { value: 'video', label: <><Film size={13} /> Videos</> },
  { value: 'audio', label: <><Music2 size={13} /> Audio</> },
  { value: 'favorites', label: <><Heart size={13} /> Favorites</> },
  { value: 'recent', label: 'Recent' },
]

function readLayout(): 'grid' | 'list' {
  try {
    return localStorage.getItem('haul.layout') === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const view = (params.get('view') as View) || 'all'
  const sort = (params.get('sort') as Sort) || 'created'
  const order = (params.get('order') as 'asc' | 'desc') || (sort === 'title' ? 'asc' : 'desc')
  const source = params.get('source') ?? ''
  const focusId = params.get('item')
  const [search, setSearch] = useState(params.get('q') ?? '')
  const q = useDebounced(search.trim(), 250)
  const [layout, setLayout] = useState<'grid' | 'list'>(readLayout)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<MediaItem | null>(null)
  const [deleting, setDeleting] = useState<MediaItem[]>([])
  const [adding, setAdding] = useState<MediaItem[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const query: MediaQuery = useMemo(
    () => ({
      kind: view === 'video' || view === 'audio' ? view : undefined,
      favorite: view === 'favorites' || undefined,
      q: q || undefined,
      sort: view === 'recent' ? 'created' : sort,
      order: view === 'recent' ? 'desc' : order,
      source: source || undefined,
    }),
    [view, q, sort, order, source],
  )
  const { items, total, sources, status, error, reload, loadMore, loadingMore, patchLocal } = useMediaList(query)
  const shown = view === 'recent' ? items.slice(0, 48) : items
  const focused = useMemo(() => items.find((i) => i.id === focusId) ?? null, [items, focusId])

  const jobs = useDownloads((s) => s.jobs)
  const inProgress = useMemo(() => {
    const g = groupJobs(jobs)
    return [...g.active, ...g.queued.filter((j) => j.status === 'queued')]
  }, [jobs])

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k)
        else next.set(k, v)
      }
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  useEffect(() => {
    if ((params.get('q') ?? '') !== q) setParam({ q: q || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // '/' focuses search on desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && selecting) {
        setSelecting(false)
        setSelected(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])

  // infinite scroll
  useEffect(() => {
    const el = sentinel.current
    if (!el || view === 'recent') return
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, view])

  const toggleSelect = useCallback((id: string) => {
    setSelecting(true)
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected])
  const endSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const menuFor = (item: MediaItem): MenuItem[] => [
    { label: item.kind === 'video' ? 'Watch' : 'Play', icon: <Play size={15} />, onSelect: () => playItem(item, shown, navigate), disabled: item.status === 'missing' },
    { label: 'Play as audio', icon: <Headphones size={15} />, hidden: item.kind !== 'video', onSelect: () => listenToItem(item), disabled: item.status === 'missing' },
    { label: 'Play next', icon: <ListPlus size={15} />, hidden: item.kind !== 'audio', onSelect: () => usePlayer.getState().enqueue([item]) },
    { label: 'Details', icon: <Info size={15} />, onSelect: () => setParam({ item: item.id }) },
    { label: item.favorite ? 'Remove favorite' : 'Add to favorites', icon: <Heart size={15} />, onSelect: () => toggleFavorite(item, (m) => patchLocal(m.id, m)) },
    { label: 'Add to playlist', icon: <ListPlus size={15} />, onSelect: () => setAdding([item]) },
    { label: saveItemLabel(), icon: isDesktop() ? <FolderOpen size={15} /> : <Download size={15} />, onSelect: () => saveItem(item), disabled: item.status === 'missing' },
    { label: 'Save audio as MP3', icon: <Music size={15} />, hidden: item.kind !== 'video', onSelect: () => saveAudio(item), disabled: item.status === 'missing' },
    { label: 'Rename', icon: <Pencil size={15} />, onSelect: () => setRenaming(item) },
    { label: 'Select', icon: <CheckSquare size={15} />, onSelect: () => toggleSelect(item.id) },
    { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => setDeleting([item]) },
  ]

  const bulkFavorite = async () => {
    const makeFav = selectedItems.some((i) => !i.favorite)
    try {
      await Promise.all(selectedItems.map((i) => api.patchMedia(i.id, { favorite: makeFav })))
      selectedItems.forEach((i) => patchLocal(i.id, { favorite: makeFav }))
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="flex">
      <div className="min-w-0 flex-1">
        <PageHeader
          title="Library"
          subtitle={status === 'ready' ? `${plural(total, 'item')}${q ? ` matching "${q}"` : ''}` : ' '}
          actions={
            <div className="flex items-center gap-1">
              <IconButton label="Grid view" active={layout === 'grid'} onClick={() => { setLayout('grid'); try { localStorage.setItem('haul.layout', 'grid') } catch { /* ignore */ } }}>
                <LayoutGrid size={18} />
              </IconButton>
              <IconButton label="List view" active={layout === 'list'} onClick={() => { setLayout('list'); try { localStorage.setItem('haul.layout', 'list') } catch { /* ignore */ } }}>
                <List size={18} />
              </IconButton>
              <IconButton label={selecting ? 'Stop selecting' : 'Select items'} active={selecting} onClick={() => (selecting ? endSelect() : setSelecting(true))}>
                <CheckSquare size={18} />
              </IconButton>
            </div>
          }
        />

        <div className="sticky top-0 z-20 space-y-3 bg-bg/95 px-4 pb-3 backdrop-blur md:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              ref={searchRef}
              leading={<Search size={16} />}
              type="search"
              placeholder="Search title, channel or source"
              aria-label="Search library"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <div className="flex gap-2">
              <Select
                aria-label="Sort by"
                value={`${sort}:${order}`}
                disabled={view === 'recent'}
                onChange={(e) => {
                  const [s, o] = e.target.value.split(':')
                  setParam({ sort: s, order: o })
                }}
                className="flex-1 sm:w-44"
              >
                <option value="created:desc">Newest first</option>
                <option value="created:asc">Oldest first</option>
                <option value="title:asc">Title A–Z</option>
                <option value="title:desc">Title Z–A</option>
                <option value="size:desc">Largest</option>
                <option value="duration:desc">Longest</option>
                <option value="played:desc">Recently played</option>
              </Select>
              {sources.length > 1 && (
                <Select aria-label="Source" value={source} onChange={(e) => setParam({ source: e.target.value || null })} className="flex-1 sm:w-36">
                  <option value="">All sources</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>
          <Segmented<View> ariaLabel="Library view" value={view} onChange={(v) => setParam({ view: v === 'all' ? null : v })} options={VIEWS} className="no-scrollbar max-w-full overflow-x-auto" />
        </div>

        {inProgress.length > 0 && !q && (
          <div className="mx-4 mb-4 flex items-center gap-3 rounded-lg bg-surface-1 px-3 py-2.5 ring-1 ring-line md:mx-8">
            <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
            <div className="flex -space-x-2">
              {inProgress.slice(0, 4).map((j) => (
                <Thumb key={j.id} src={j.thumbnail} kind={j.kind} className="aspect-video w-12 ring-2 ring-surface-1" showDuration={false} iconSize={12} />
              ))}
            </div>
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">
              {plural(inProgress.length, 'item')} still processing. They appear here once finished.
            </p>
            <Link to="/downloads" className="shrink-0 text-[12.5px] font-semibold text-accent">
              View
            </Link>
          </div>
        )}

        <div className="px-2.5 pb-8 md:px-6">
          {status === 'loading' ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="p-1.5">
                  <Skeleton className="aspect-video w-full" />
                  <Skeleton className="mt-2.5 h-3.5 w-4/5" />
                  <Skeleton className="mt-1.5 h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : status === 'error' ? (
            <div className="px-2">
              <ErrorState message={error} onRetry={reload} />
            </div>
          ) : shown.length === 0 ? (
            q || source ? (
              <EmptyState icon={<Search size={22} />} title="No matches" body="Try a different search or clear the filters." action={<Button onClick={() => { setSearch(''); setParam({ source: null, q: null }) }}>Clear filters</Button>} />
            ) : view === 'favorites' ? (
              <EmptyState icon={<Heart size={22} />} title="No favorites yet" body="Tap the heart on anything in your library to keep it close." />
            ) : (
              <EmptyState
                icon={<LibraryIcon size={22} />}
                title={view === 'audio' ? 'No audio yet' : view === 'video' ? 'No videos yet' : 'Your library is empty'}
                body="Everything you download shows up here, ready to play offline."
                action={<Button variant="primary" onClick={() => navigate('/')}>Download something</Button>}
              />
            )
          ) : layout === 'grid' ? (
            <div className={cn('grid gap-1 sm:gap-2', focused ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5')}>
              {shown.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  selecting={selecting}
                  selected={selected.has(item.id)}
                  focused={item.id === focusId}
                  onOpen={() => setParam({ item: item.id })}
                  onPlay={() => playItem(item, shown, navigate)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  menu={menuFor(item)}
                />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface-1/40 ring-1 ring-line">
              {shown.map((item) => (
                <MediaRow
                  key={item.id}
                  item={item}
                  selecting={selecting}
                  selected={selected.has(item.id)}
                  focused={item.id === focusId}
                  onOpen={() => setParam({ item: item.id })}
                  onPlay={() => playItem(item, shown, navigate)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  menu={menuFor(item)}
                />
              ))}
            </ul>
          )}
          <div ref={sentinel} />
          {loadingMore && (
            <div className="grid place-items-center py-6 text-fg-3">
              <Loader2 className="animate-spin" size={18} />
            </div>
          )}
        </div>
      </div>

      {/* Desktop: contextual details panel */}
      {focused && (
        <aside className="sticky top-0 hidden h-dvh w-[340px] shrink-0 border-l border-line bg-bg xl:block">
          <MediaDetails
            item={focused}
            actions={{
              onPlay: () => playItem(focused, shown, navigate),
              onRename: () => setRenaming(focused),
              onDelete: () => setDeleting([focused]),
              onAddToPlaylist: () => setAdding([focused]),
              onChanged: (m) => patchLocal(m.id, m),
              onClose: () => setParam({ item: null }),
            }}
          />
        </aside>
      )}
      {/* Mobile and tablet: the same panel as a sheet */}
      {focused && (
        <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Item details">
          <button aria-label="Close" className="absolute inset-0 bg-scrim animate-fade" onClick={() => setParam({ item: null })} />
          <div className="safe-bottom absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-hidden rounded-t-2xl bg-surface-1 shadow-pop animate-rise sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[380px] sm:rounded-none">
            <MediaDetails
              item={focused}
              actions={{
                onPlay: () => playItem(focused, shown, navigate),
                onRename: () => setRenaming(focused),
                onDelete: () => setDeleting([focused]),
                onAddToPlaylist: () => setAdding([focused]),
                onChanged: (m) => patchLocal(m.id, m),
                onClose: () => setParam({ item: null }),
              }}
            />
          </div>
        </div>
      )}

      {/* Multi-select action bar */}
      {selecting && (
        <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-2xl items-center gap-1 rounded-xl bg-surface-2 p-2 shadow-pop animate-rise md:bottom-6">
          <IconButton label="Done" size="sm" onClick={endSelect}>
            <X size={16} />
          </IconButton>
          <span className="mr-auto pl-1 text-[13px] font-medium tabular">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === shown.length ? new Set() : new Set(shown.map((i) => i.id)))}>
            {selected.size === shown.length ? 'None' : 'All'}
          </Button>
          <IconButton label="Favorite selected" size="sm" disabled={!selected.size} onClick={bulkFavorite}>
            <Heart size={16} />
          </IconButton>
          <IconButton label="Add selected to playlist" size="sm" disabled={!selected.size} onClick={() => setAdding(selectedItems)}>
            <ListPlus size={16} />
          </IconButton>
          {selectedItems.every((i) => i.kind === 'audio') && selected.size > 0 && (
            <IconButton label="Play selected" size="sm" onClick={() => usePlayer.getState().playAudio(selectedItems)}>
              <Play size={16} />
            </IconButton>
          )}
          <IconButton label="Delete selected" size="sm" disabled={!selected.size} onClick={() => setDeleting(selectedItems)} className="text-danger hover:text-danger">
            <Trash2 size={16} />
          </IconButton>
        </div>
      )}

      <RenameDialog item={renaming} onClose={() => setRenaming(null)} onDone={(m) => patchLocal(m.id, m)} />
      <DeleteDialog
        items={deleting}
        onClose={() => setDeleting([])}
        onDone={() => {
          if (focused && deleting.some((d) => d.id === focused.id)) setParam({ item: null })
          endSelect()
        }}
      />
      <AddToPlaylistDialog items={adding} onClose={() => setAdding([])} />
    </div>
  )
}
