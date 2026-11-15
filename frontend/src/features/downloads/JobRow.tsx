import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, CalendarClock, CircleAlert, CircleCheck, Copy, EllipsisVertical, FolderOpen, Headphones, MonitorPlay, Music2, Pause, Play, RotateCcw, Trash2, X, Zap,
} from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { Badge, ProgressBar } from '../../components/ui/Feedback'
import { Menu } from '../../components/ui/Menu'
import { Thumb } from '../../components/ui/Thumb'
import { api, mediaUrls } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatBytes, formatDate, formatEta, formatRelative, formatSpeed } from '../../lib/format'
import type { Job } from '../../lib/types'
import { jobActions } from '../../stores/downloads'
import { usePlayer } from '../../stores/player'
import { toast, toastError } from '../../stores/ui'
import { canPreview, useLivePreview } from './liveStore'

const STAGE_LABEL: Record<string, string> = {
  starting: 'Starting…',
  merging: 'Merging video and audio…',
  converting: 'Converting audio…',
  embedding: 'Embedding artwork…',
  tagging: 'Writing metadata…',
  finalizing: 'Finalizing…',
  processing: 'Processing…',
  subtitles: 'Fetching subtitles…',
  pausing: 'Pausing…',
  cancelling: 'Cancelling…',
}

function describe(job: Job): { text: string; tone: 'muted' | 'accent' | 'danger' | 'success' } {
  switch (job.status) {
    case 'downloading': {
      if (job.stage && job.stage !== 'downloading') return { text: STAGE_LABEL[job.stage] ?? job.stage, tone: 'accent' }
      const parts = [
        job.total_bytes ? `${formatBytes(job.downloaded_bytes)} of ${formatBytes(job.total_bytes)}` : formatBytes(job.downloaded_bytes),
        job.speed ? formatSpeed(job.speed) : null,
        formatEta(job.eta) || null,
      ]
      return { text: parts.filter(Boolean).join(' · '), tone: 'accent' }
    }
    case 'processing':
      return { text: STAGE_LABEL[job.stage ?? 'processing'] ?? 'Processing…', tone: 'accent' }
    case 'queued':
      if (job.scheduled_at && job.scheduled_at * 1000 > Date.now()) {
        return { text: job.error ? `Retrying ${formatRelative(job.scheduled_at)}. ${job.error}` : `Scheduled · ${formatDate(job.scheduled_at)}`, tone: job.error ? 'danger' : 'muted' }
      }
      return { text: job.priority > 0 ? 'Queued · high priority' : job.priority < 0 ? 'Queued · low priority' : 'Waiting for a free slot', tone: 'muted' }
    case 'paused':
      return { text: job.downloaded_bytes ? `Paused at ${formatBytes(job.downloaded_bytes)}` : 'Paused', tone: 'muted' }
    case 'completed':
      return { text: `${formatBytes(job.total_bytes)} · ${formatRelative(job.finished_at)}`, tone: 'success' }
    case 'failed':
      return { text: job.error ?? 'Failed', tone: 'danger' }
    case 'cancelled':
      return { text: 'Cancelled', tone: 'muted' }
  }
}

async function run(fn: () => Promise<unknown>, failTitle: string) {
  try {
    await fn()
  } catch (e) {
    toastError(e, failTitle)
  }
}

export const JobRow = memo(function JobRow({ job }: { job: Job }) {
  const navigate = useNavigate()
  const playAudio = usePlayer((s) => s.playAudio)
  const { text, tone } = describe(job)
  const active = job.status === 'downloading' || job.status === 'processing'
  const busyStage = job.stage === 'pausing' || job.stage === 'cancelling'
  const indeterminate = active && (job.status === 'processing' || job.stage === 'starting' || (!job.total_bytes && job.progress === 0))

  const openMedia = async () => {
    if (!job.media_id) return
    if (job.kind === 'video') navigate(`/watch/${job.media_id}`)
    else {
      try {
        playAudio([await api.mediaItem(job.media_id)])
      } catch (e) {
        toastError(e, "Couldn't open the file")
      }
    }
  }

  return (
    <li className="group flex items-center gap-3 px-4 py-3 md:gap-4 md:px-5">
      <button
        onClick={job.status === 'completed' ? openMedia : undefined}
        tabIndex={job.status === 'completed' ? 0 : -1}
        aria-label={job.status === 'completed' ? `Play ${job.title ?? ''}` : undefined}
        className={cn('relative shrink-0', job.status === 'completed' ? 'cursor-pointer' : 'cursor-default')}
      >
        <Thumb src={job.thumbnail ?? (job.media_id ? mediaUrls.thumb(job.media_id) : null)} kind={job.kind} className="aspect-video w-24 md:w-28" showDuration={false} iconSize={18} />
        {job.kind === 'audio' && (
          <span className="absolute left-1 top-1 grid size-5 place-items-center rounded bg-black/70 text-white">
            <Music2 size={11} />
          </span>
        )}
        {job.status === 'completed' && (
          <span className="absolute inset-0 grid place-items-center rounded-md bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Play size={20} className="fill-white text-white" />
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13.5px] font-medium text-fg" title={job.title ?? job.url}>
            {job.title ?? job.url}
          </p>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
          {job.source && <span className="shrink-0">{job.source}</span>}
          {job.playlist_title && <span className="truncate">· {job.playlist_title}</span>}
          <Badge className="ml-0.5 shrink-0">{job.kind === 'audio' ? job.options.audio_format.toUpperCase() : job.options.container.toUpperCase()}</Badge>
          {job.options.quality?.startsWith('h') && job.kind === 'video' && <Badge className="shrink-0">≤{job.options.quality.slice(1)}p</Badge>}
          {job.options.audio_format_id && (
            <Badge className="max-w-28 shrink truncate">
              {job.options.audio_format_id}
            </Badge>
          )}
        </div>
        {(active || job.status === 'paused') && (
          <ProgressBar
            className="mt-2"
            value={job.progress}
            indeterminate={indeterminate}
            tone={job.status === 'paused' ? 'muted' : 'accent'}
            label={`Download progress for ${job.title ?? 'item'}`}
          />
        )}
        <p
          className={cn(
            'mt-1.5 flex items-center gap-1.5 truncate text-[12px] tabular',
            tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-fg-2' : tone === 'accent' ? 'text-fg-2' : 'text-fg-3',
          )}
        >
          {job.status === 'completed' && <CircleCheck size={13} className="shrink-0 text-success" />}
          {job.status === 'failed' && <CircleAlert size={13} className="shrink-0" />}
          {job.status === 'queued' && job.scheduled_at && !job.error && <CalendarClock size={13} className="shrink-0" />}
          {active && job.progress > 0 && !indeterminate && <span className="font-medium text-fg">{Math.floor(job.progress * 100)}%</span>}
          <span className="truncate">{text}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {canPreview(job) && (
          <IconButton
            label={job.kind === 'video' ? 'Watch while downloading' : 'Listen while downloading'}
            size="sm"
            onClick={() => useLivePreview.getState().open(job.id)}
          >
            {job.kind === 'video' ? <MonitorPlay size={16} /> : <Headphones size={16} />}
          </IconButton>
        )}
        {active && !busyStage && (
          <IconButton label="Pause" size="sm" onClick={() => run(() => jobActions.pause(job.id), "Couldn't pause")}>
            <Pause size={16} />
          </IconButton>
        )}
        {job.status === 'paused' && (
          <IconButton label="Resume" size="sm" onClick={() => run(() => jobActions.resume(job.id), "Couldn't resume")}>
            <Play size={16} />
          </IconButton>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <IconButton label="Retry" size="sm" onClick={() => run(() => jobActions.retry(job.id), "Couldn't retry")}>
            <RotateCcw size={16} />
          </IconButton>
        )}
        {job.status === 'completed' && job.media_id && (
          <IconButton label={job.kind === 'video' ? 'Watch' : 'Play'} size="sm" onClick={openMedia}>
            <Play size={16} />
          </IconButton>
        )}
        {(active || job.status === 'queued' || job.status === 'paused') && !busyStage && (
          <IconButton label="Cancel" size="sm" onClick={() => run(() => jobActions.cancel(job.id), "Couldn't cancel")}>
            <X size={16} />
          </IconButton>
        )}
        <Menu
          trigger={(p) => (
            <IconButton label="More actions" size="sm" {...p}>
              <EllipsisVertical size={16} />
            </IconButton>
          )}
          items={[
            { label: 'Start now', icon: <Zap size={15} />, hidden: !(job.status === 'queued' && job.scheduled_at), onSelect: () => run(() => jobActions.startNow(job.id), "Couldn't start") },
            { label: 'Move up (higher priority)', icon: <ArrowUp size={15} />, hidden: !['queued', 'paused'].includes(job.status), onSelect: () => run(() => jobActions.priority(job.id, Math.min(10, job.priority + 1)), "Couldn't change priority") },
            { label: 'Move down', icon: <ArrowDown size={15} />, hidden: !['queued', 'paused'].includes(job.status), onSelect: () => run(() => jobActions.priority(job.id, Math.max(-10, job.priority - 1)), "Couldn't change priority") },
            { label: 'Show in library', icon: <FolderOpen size={15} />, hidden: !job.media_id, onSelect: () => navigate(`/library?view=${job.kind}&item=${job.media_id}`) },
            {
              label: 'Copy source link',
              icon: <Copy size={15} />,
              onSelect: () =>
                navigator.clipboard?.writeText(job.url).then(
                  () => toast({ tone: 'success', title: 'Link copied' }),
                  () => toast({ tone: 'danger', title: "Couldn't copy the link" }),
                ),
            },
            { label: active ? 'Cancel and remove' : 'Remove from list', icon: <Trash2 size={15} />, danger: true, onSelect: () => run(() => jobActions.remove(job.id), "Couldn't remove") },
          ]}
        />
      </div>
    </li>
  )
})
