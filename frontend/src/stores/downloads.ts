import { create } from 'zustand'
import { api } from '../lib/api'
import type { Job, JobStatus } from '../lib/types'

export type JobGroup = 'active' | 'queued' | 'completed' | 'failed'

export const GROUP_OF: Record<JobStatus, JobGroup> = {
  downloading: 'active',
  processing: 'active',
  queued: 'queued',
  paused: 'queued',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'failed',
}

interface DownloadsState {
  jobs: Record<string, Job>
  loaded: boolean
  concurrency: number
  load: () => Promise<void>
  upsert: (job: Job) => void
  patch: (id: string, fields: Partial<Job>) => void
  remove: (id: string) => void
}

export const useDownloads = create<DownloadsState>((set, get) => ({
  jobs: {},
  loaded: false,
  concurrency: 3,
  load: async () => {
    const res = await api.downloads()
    const jobs: Record<string, Job> = {}
    for (const j of res.items) jobs[j.id] = j
    set({ jobs, loaded: true, concurrency: res.concurrency })
  },
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  patch: (id, fields) => {
    const cur = get().jobs[id]
    if (!cur) return
    set((s) => ({ jobs: { ...s.jobs, [id]: { ...cur, ...fields } } }))
  },
  remove: (id) =>
    set((s) => {
      const next = { ...s.jobs }
      delete next[id]
      return { jobs: next }
    }),
}))

/** Sorted helpers kept outside the store so components can memoize on `jobs`. */
export function groupJobs(jobs: Record<string, Job>): Record<JobGroup, Job[]> {
  const out: Record<JobGroup, Job[]> = { active: [], queued: [], completed: [], failed: [] }
  for (const j of Object.values(jobs)) out[GROUP_OF[j.status]].push(j)
  out.active.sort((a, b) => (a.started_at ?? 0) - (b.started_at ?? 0))
  out.queued.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'queued' ? -1 : 1
    return b.priority - a.priority || a.created_at - b.created_at
  })
  out.completed.sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0))
  out.failed.sort((a, b) => (b.finished_at ?? b.updated_at) - (a.finished_at ?? a.updated_at))
  return out
}

export const jobActions = {
  pause: async (id: string) => useDownloads.getState().upsert(normalize(await api.pause(id))),
  resume: async (id: string) => useDownloads.getState().upsert(await api.resume(id)),
  retry: async (id: string) => useDownloads.getState().upsert(await api.retry(id)),
  cancel: async (id: string) => useDownloads.getState().upsert(normalize(await api.cancel(id))),
  remove: async (id: string) => {
    await api.deleteJob(id)
    useDownloads.getState().remove(id)
  },
  priority: async (id: string, priority: number) => useDownloads.getState().upsert(await api.patchJob(id, { priority })),
  startNow: async (id: string) => useDownloads.getState().upsert(await api.patchJob(id, { clear_schedule: true })),
}

/** "pausing"/"cancelling" are transitional responses. Keep showing the job as active until the event lands. */
function normalize(job: Job): Job {
  const s = job.status as string
  if (s === 'pausing' || s === 'cancelling') return { ...job, status: 'downloading', stage: s }
  return job
}
