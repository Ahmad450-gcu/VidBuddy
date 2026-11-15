import { create } from 'zustand'
import type { Job } from '../../lib/types'

/** Which download is being watched. Lives outside the row so the player survives the row moving tabs. */
export const useLivePreview = create<{ jobId: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  jobId: null,
  open: (jobId) => set({ jobId }),
  close: () => set({ jobId: null }),
}))

/** A running or paused download that has bytes on disk can be played. */
export function canPreview(job: Job): boolean {
  if (job.downloaded_bytes <= 0) return false
  if (job.status === 'downloading') return !job.stage || job.stage === 'downloading'
  return job.status === 'paused'
}
