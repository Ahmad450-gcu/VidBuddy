import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, CircleAlert, CircleCheck, Clock3, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/layout/Logo'
import { Button } from '../../components/ui/Button'
import { Segmented } from '../../components/ui/Controls'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, Skeleton } from '../../components/ui/Feedback'
import { api } from '../../lib/api'
import { formatSpeed, plural } from '../../lib/format'
import { groupJobs, useDownloads, type JobGroup } from '../../stores/downloads'
import { toast, toastError } from '../../stores/ui'
import { JobRow } from './JobRow'

const EMPTY: Record<JobGroup, { icon: React.ReactNode; title: string; body: string }> = {
  active: { icon: <ArrowDownToLine size={22} />, title: 'Nothing downloading', body: 'Paste a link on the Home screen and it will show up here with live progress.' },
  queued: { icon: <Clock3 size={22} />, title: 'Queue is empty', body: 'Jobs wait here when every download slot is busy, when paused, or when scheduled for later.' },
  completed: { icon: <CircleCheck size={22} />, title: 'No finished downloads yet', body: 'Completed downloads land in your library automatically.' },
  failed: { icon: <CircleAlert size={22} />, title: 'No failed downloads', body: 'If something goes wrong, you can retry it from here.' },
}

export function DownloadsPage() {
  const jobs = useDownloads((s) => s.jobs)
  const loaded = useDownloads((s) => s.loaded)
  const concurrency = useDownloads((s) => s.concurrency)
  const groups = useMemo(() => groupJobs(jobs), [jobs])
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const fallbackTab: JobGroup = groups.active.length ? 'active' : groups.queued.length ? 'queued' : groups.failed.some((j) => j.status === 'failed') ? 'failed' : 'completed'
  const tab = (params.get('tab') as JobGroup) || fallbackTab
  const [confirmClear, setConfirmClear] = useState(false)
  const list = groups[tab]
  const totalSpeed = groups.active.reduce((s, j) => s + (j.speed ?? 0), 0)

  const bulk = async (fn: () => Promise<{ affected: number }>, done: string) => {
    try {
      const r = await fn()
      toast({ tone: 'success', title: `${done}: ${plural(r.affected, 'download')}` })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Downloads"
        subtitle={
          groups.active.length
            ? `${groups.active.length} of ${concurrency} slots busy${totalSpeed ? ` · ${formatSpeed(totalSpeed)}` : ''}`
            : `Up to ${concurrency} at a time`
        }
        actions={
          <>
            {(groups.active.length > 0 || groups.queued.some((j) => j.status === 'queued')) && (
              <Button size="sm" variant="ghost" icon={<Pause size={15} />} onClick={() => bulk(api.pauseAll, 'Paused')}>
                Pause all
              </Button>
            )}
            {groups.queued.some((j) => j.status === 'paused') && (
              <Button size="sm" variant="ghost" icon={<Play size={15} />} onClick={() => bulk(api.resumeAll, 'Resumed')}>
                Resume all
              </Button>
            )}
            <Button size="sm" variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/')}>
              New
            </Button>
          </>
        }
      />

      <div className="flex items-center justify-between gap-3 px-4 md:px-8">
        <Segmented<JobGroup>
          ariaLabel="Download status"
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          className="no-scrollbar max-w-full overflow-x-auto"
          options={[
            { value: 'active', label: <>Active <Count n={groups.active.length} /></> },
            { value: 'queued', label: <>Queued <Count n={groups.queued.length} /></> },
            { value: 'completed', label: <>Done <Count n={groups.completed.length} /></> },
            { value: 'failed', label: <>Failed <Count n={groups.failed.length} danger={groups.failed.some((j) => j.status === 'failed')} /></> },
          ]}
        />
        {(tab === 'completed' || tab === 'failed') && list.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => setConfirmClear(true)} className="hidden sm:inline-flex">
            Clear
          </Button>
        )}
      </div>

      <div className="mt-4 px-0 md:px-8">
        {!loaded ? (
          <div className="space-y-px">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="aspect-video w-24" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            {...EMPTY[tab]}
            action={tab === 'active' || tab === 'completed' ? <Button variant="primary" onClick={() => navigate('/')}>Paste a link</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden bg-surface-1 md:rounded-xl md:ring-1 md:ring-line">
            {list.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </ul>
        )}
        {(tab === 'completed' || tab === 'failed') && list.length > 0 && (
          <div className="flex justify-center py-4 sm:hidden">
            <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => setConfirmClear(true)}>
              Clear {tab === 'completed' ? 'finished' : 'failed'}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={tab === 'completed' ? 'Clear finished downloads?' : 'Clear failed downloads?'}
        body="This only removes them from this list. Files in your library are not touched."
        confirmLabel="Clear"
        onConfirm={() => bulk(() => api.clearJobs(tab === 'completed' ? 'completed' : 'failed'), 'Cleared')}
      />
    </div>
  )
}

function Count({ n, danger }: { n: number; danger?: boolean }) {
  if (!n) return null
  return <span className={`ml-1 text-[11px] tabular ${danger ? 'text-danger' : 'text-fg-3'}`}>{n}</span>
}
