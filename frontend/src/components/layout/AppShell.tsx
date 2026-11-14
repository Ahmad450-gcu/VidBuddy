import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowDownToLine, FolderHeart, HardDrive, Home, Library, ListMusic, Menu as MenuIcon, Settings, WifiOff, KeyRound } from 'lucide-react'
import { cn } from '../../lib/cn'
import { install } from '../../lib/platform'
import { groupJobs, useDownloads } from '../../stores/downloads'
import { useUi } from '../../stores/ui'
import { usePlayer } from '../../stores/player'
import { Toasts } from '../ui/Toasts'
import { MiniPlayer } from '../../features/player/MiniPlayer'
import { Logo } from './Logo'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/downloads', label: 'Downloads', icon: ArrowDownToLine },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/playlists', label: 'Playlists', icon: ListMusic },
  { to: '/storage', label: 'Storage', icon: HardDrive },
  { to: '/settings', label: 'Settings', icon: Settings },
]
const MOBILE_NAV = [NAV[0], NAV[1], NAV[2], NAV[3], { to: '/more', label: 'More', icon: MenuIcon }]

function useActiveCount() {
  const jobs = useDownloads((s) => s.jobs)
  return useMemo(() => {
    const g = groupJobs(jobs)
    return { active: g.active.length, queued: g.queued.filter((j) => j.status === 'queued').length, failed: g.failed.filter((j) => j.status === 'failed').length }
  }, [jobs])
}

export function AppShell() {
  const { active, queued } = useActiveCount()
  const hasTrack = usePlayer((s) => s.queue.length > 0)
  const location = useLocation()
  const fullBleed = location.pathname.startsWith('/watch/')

  if (fullBleed) {
    return (
      <>
        <Outlet />
        <Toasts />
      </>
    )
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar active={active} queued={queued} />
      <div className="safe-top flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <main id="main" className={cn('flex-1 pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0', hasTrack && 'pb-[calc(140px+env(safe-area-inset-bottom))] md:pb-24')}>
          <Outlet />
        </main>
      </div>
      <MiniPlayer />
      <BottomNav active={active + queued} />
      <Toasts />
    </div>
  )
}

function Sidebar({ active, queued }: { active: number; queued: number }) {
  const [canInstall, setCanInstall] = useState(install.available)
  useEffect(() => {
    const unsub = install.subscribe(setCanInstall)
    return () => {
      unsub()
    }
  }, [])
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-bg px-3 py-4 md:flex lg:w-64">
      <div className="mb-6 flex items-center gap-2.5 px-2.5">
        <Logo size={28} />
        <span className="text-[17px] font-semibold tracking-tight">VidBuddy</span>
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                'group flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium transition-colors',
                isActive ? 'bg-surface-2 text-fg' : 'text-fg-2 hover:bg-surface-1 hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                <n.icon size={17} className={isActive ? 'text-accent' : 'text-fg-3 group-hover:text-fg-2'} />
                <span className="flex-1">{n.label}</span>
                {n.to === '/downloads' && active + queued > 0 && (
                  <span className="rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent tabular">{active + queued}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-3 px-1">
        <FavoritesShortcut />
        {canInstall && (
          <button
            onClick={() => install.prompt()}
            className="flex w-full items-center gap-2.5 rounded-md bg-surface-1 px-3 py-2.5 text-left text-[12.5px] text-fg-2 ring-1 ring-line hover:text-fg"
          >
            <ArrowDownToLine size={15} className="text-accent" />
            Install VidBuddy as an app
          </button>
        )}
      </div>
    </aside>
  )
}

function FavoritesShortcut() {
  return (
    <NavLink
      to="/library?view=favorites"
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] text-fg-3 hover:text-fg-2"
    >
      <FolderHeart size={15} />
      Favorites
    </NavLink>
  )
}

function BottomNav({ active }: { active: number }) {
  return (
    <nav
      aria-label="Primary"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur-md md:hidden"
    >
      <div className="grid h-16 grid-cols-5">
        {MOBILE_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={'end' in n ? n.end : undefined}
            className={({ isActive }) =>
              cn('relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium', isActive ? 'text-fg' : 'text-fg-3')
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn('grid h-7 w-12 place-items-center rounded-full transition-colors', isActive && 'bg-surface-2')}>
                  <n.icon size={19} className={isActive ? 'text-accent' : ''} />
                </span>
                {n.label}
                {n.to === '/downloads' && active > 0 && (
                  <span className="absolute right-[calc(50%-20px)] top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-accent-fg tabular">
                    {active}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function ConnectionBanner() {
  const conn = useUi((s) => s.conn)
  if (conn === 'online' || conn === 'connecting') return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-danger-soft px-4 py-2 text-[12.5px] text-danger">
      {conn === 'unauthorized' ? <KeyRound size={14} /> : <WifiOff size={14} />}
      {conn === 'unauthorized' ? (
        <span>
          This server needs an access token.{' '}
          <NavLink to="/settings" className="font-semibold underline underline-offset-2">
            Add it in Settings
          </NavLink>
        </span>
      ) : (
        <span>Can't reach the VidBuddy server. Downloads continue on the server; reconnecting…</span>
      )}
    </div>
  )
}
