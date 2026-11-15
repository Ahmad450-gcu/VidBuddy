import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, CircleCheck, RotateCcw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { ProgressBar } from '../../components/ui/Feedback'
import { api, apiUrl } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import { useDownloads } from '../../stores/downloads'
import { usePlayer } from '../../stores/player'
import { toastError } from '../../stores/ui'
import { useLivePreview } from './liveStore'

/** Ask the server why the stream wouldn't play (it answers 409 with a reason). */
async function explain(url: string): Promise<{ message: string; retry: boolean }> {
  const ctrl = new AbortController()
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (r.ok) return { message: 'The stream stopped. Try again.', retry: true }
    const body = await r.json().catch(() => null)
    const detail = body?.detail
    return {
      message: (typeof detail === 'object' && detail?.message) || 'This download can’t be played yet.',
      retry: detail?.code !== 'unplayable',
    }
  } catch {
    return { message: 'Couldn’t reach VidBuddy to play this.', retry: true }
  } finally {
    ctrl.abort()
  }
}

export function LivePreview() {
  const jobId = useLivePreview((s) => s.jobId)
  return jobId ? <PreviewDialog key={jobId} jobId={jobId} /> : null
}

function PreviewDialog({ jobId }: { jobId: string }) {
  const close = useLivePreview((s) => s.close)
  const job = useDownloads((s) => s.jobs[jobId])
  const navigate = useNavigate()
  const playAudio = usePlayer((s) => s.playAudio)
  const [attempt, setAttempt] = useState(0)
  const [problem, setProblem] = useState<{ message: string; retry: boolean } | null>(null)
  const [ended, setEnded] = useState(false)

  if (!job) return null
  const src = apiUrl(`/downloads/${job.id}/preview`, { n: attempt })
  const finished = job.status === 'completed' && !!job.media_id
  const downloading = job.status === 'downloading' || job.status === 'processing'

  const restart = () => {
    setProblem(null)
    setEnded(false)
    setAttempt((n) => n + 1)
  }
  const openFinished = async () => {
    if (!job.media_id) return
    close()
    if (job.kind === 'video') navigate(`/watch/${job.media_id}`)
    else {
      try {
        playAudio([await api.mediaItem(job.media_id)])
      } catch (e) {
        toastError(e, "Couldn't open the file")
      }
    }
  }
  const media = {
    key: `${job.id}-${attempt}`,
    src,
    controls: true,
    autoPlay: true,
    playsInline: true,
    onError: async () => setProblem(await explain(src)),
    onEnded: () => setEnded(true),
  }

  return (
    <Dialog
      open
      onClose={close}
      wide
      title={job.title ?? 'Playing while downloading'}
      description={
        finished
          ? 'Download finished.'
          : downloading
            ? 'Playing what has downloaded so far. More arrives as the download continues.'
            : 'The download is paused. Playing what was downloaded before it stopped.'
      }
      footer={
        finished ? (
          <Button variant="primary" onClick={openFinished}>
            {job.kind === 'video' ? 'Watch the full video' : 'Play the full file'}
          </Button>
        ) : (
          <Button onClick={close}>Close</Button>
        )
      }
    >
      {problem ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-2 px-5 py-8 text-center">
          <CircleAlert size={22} className="text-danger" />
          <p className="max-w-sm text-[13.5px] text-fg-2">{problem.message}</p>
          {problem.retry && !finished && (
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={restart}>
              Try again
            </Button>
          )}
        </div>
      ) : job.kind === 'video' ? (
        <video {...media} className="aspect-video w-full rounded-lg bg-black" />
      ) : (
        <audio {...media} className="w-full" />
      )}

      {!finished && (
        <div className="mt-3">
          <ProgressBar value={job.progress} tone={downloading ? 'accent' : 'muted'} label="Download progress" />
          <p className="mt-1.5 text-[12px] text-fg-3 tabular">
            {Math.floor(job.progress * 100)}% downloaded
            {job.total_bytes ? ` · ${formatBytes(job.downloaded_bytes)} of ${formatBytes(job.total_bytes)}` : ''}
            {' · '}you can seek within the part that has loaded
          </p>
        </div>
      )}
      {ended && !finished && !problem && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
          <p className="text-[13px] text-fg-2">You’ve reached the end of what’s downloaded so far.</p>
          {downloading && (
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={restart}>
              Reload
            </Button>
          )}
        </div>
      )}
      {finished && (
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-fg-2">
          <CircleCheck size={15} className="text-success" />
          The whole file is in your library now.
        </p>
      )}
    </Dialog>
  )
}
