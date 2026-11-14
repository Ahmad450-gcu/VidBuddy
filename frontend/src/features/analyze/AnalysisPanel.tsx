import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Feedback'
import { useAnalysis } from './analysisStore'
import { MediaOptions } from './MediaOptions'
import { PlaylistOptions } from './PlaylistOptions'

const HINTS: Record<string, string> = {
  unsupported: 'Try the direct page of the video, or a direct link to the media file.',
  auth: 'Private, age-restricted or members-only media needs a signed-in session. Haul can only fetch public media.',
  geo: 'The server running Haul is in a region where this media is blocked.',
  drm: 'Streaming services that use DRM (Netflix, Spotify and similar) cannot be downloaded.',
  network: 'Check that the server has an internet connection, then try again.',
  timeout: 'The site was slow to respond. Trying again usually works.',
  blocked: 'The site is rate limiting automated access from this server. Wait a few minutes.',
  rate_limited: 'Too many requests in a short time. Wait a moment.',
  offline: 'The Haul server is unreachable.',
}

export function AnalysisPanel() {
  const { status, data, error, analyze, reset } = useAnalysis()

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Reading link" className="rounded-xl bg-surface-1 p-5 ring-1 ring-line">
        <div className="flex gap-4">
          <Skeleton className="aspect-video w-32 sm:w-48" />
          <div className="flex-1 space-y-2.5 pt-1">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-20" />
          ))}
        </div>
        <p className="mt-4 text-[12.5px] text-fg-3">Reading the page and discovering formats…</p>
      </div>
    )
  }

  if (status === 'error' && error) {
    return (
      <div role="alert" className="flex gap-3 rounded-xl bg-surface-1 p-5 ring-1 ring-line animate-rise">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
          <AlertTriangle size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{error.message}</p>
          {HINTS[error.code] && <p className="mt-1 text-[13px] text-fg-2">{HINTS[error.code]}</p>}
          <div className="mt-4 flex gap-2">
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => analyze(undefined, true)}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              Clear
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'ready' && data) {
    return data.type === 'playlist' ? <PlaylistOptions key={data.url} data={data} onQueued={reset} /> : <MediaOptions key={data.url} data={data} onQueued={reset} />
  }
  return null
}
