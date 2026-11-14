import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, useSearchParams } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Spinner } from './components/ui/Feedback'
import { connectEvents, onMediaAdded } from './lib/events'
import { useDownloads } from './stores/downloads'
import { usePrefs } from './stores/prefs'
import { applyTheme, toast, useUi } from './stores/ui'
import { usePlayer } from './stores/player'
import { AudioEngine } from './features/player/AudioEngine'
import { HomePage } from './features/home/HomePage'
import { DownloadsPage } from './features/downloads/DownloadsPage'
import { extractUrl } from './lib/share'
import { UpdatePrompt } from './components/layout/UpdatePrompt'

// Heavier screens load on demand
const LibraryPage = lazy(() => import('./features/library/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const VideoPlayerPage = lazy(() => import('./features/player/VideoPlayerPage').then((m) => ({ default: m.VideoPlayerPage })))
const PlaylistsPage = lazy(() => import('./features/playlists/PlaylistsPage').then((m) => ({ default: m.PlaylistsPage })))
const PlaylistDetailPage = lazy(() => import('./features/playlists/PlaylistsPage').then((m) => ({ default: m.PlaylistDetailPage })))
const StoragePage = lazy(() => import('./features/storage/StoragePage').then((m) => ({ default: m.StoragePage })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const MorePage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.MorePage })))

function Loading() {
  return (
    <div className="grid min-h-[50dvh] place-items-center text-fg-3">
      <Spinner size={22} />
    </div>
  )
}

/** Web Share Target: /share?url=…&text=…&title=… → Home with the link analyzed. */
function ShareRoute() {
  const [params] = useSearchParams()
  const url = extractUrl([params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' '))
  return <Navigate to={url ? `/?url=${encodeURIComponent(url)}` : '/'} replace />
}

const lazyEl = (el: React.ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>

export const routes = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/downloads', element: <DownloadsPage /> },
      { path: '/library', element: lazyEl(<LibraryPage />) },
      { path: '/playlists', element: lazyEl(<PlaylistsPage />) },
      { path: '/playlists/:id', element: lazyEl(<PlaylistDetailPage />) },
      { path: '/storage', element: lazyEl(<StoragePage />) },
      { path: '/settings', element: lazyEl(<SettingsPage />) },
      { path: '/more', element: lazyEl(<MorePage />) },
      { path: '/watch/:id', element: lazyEl(<VideoPlayerPage />) },
      { path: '/share', element: <ShareRoute /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

const router = createBrowserRouter(routes)

export default function App() {
  const theme = useUi((s) => s.theme)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])

  useEffect(() => {
    useDownloads.getState().load().catch(() => undefined)
    usePrefs.getState().load().catch(() => undefined)
    const disconnect = connectEvents()
    const off = onMediaAdded((job, media) =>
      toast({
        tone: 'success',
        title: 'Download complete',
        body: media.title,
        action: {
          label: media.kind === 'video' ? 'Watch' : 'Play',
          run: () => (media.kind === 'video' ? router.navigate(`/watch/${media.id}`) : usePlayer.getState().playAudio([media])),
        },
        duration: job.playlist_title ? 3000 : 6000,
      }),
    )
    return () => {
      disconnect()
      off()
    }
  }, [])

  return (
    <>
      <RouterProvider router={router} />
      <AudioEngine />
      <UpdatePrompt />
    </>
  )
}
