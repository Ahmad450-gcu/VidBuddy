import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '../../lib/types'
import { JobRow } from './JobRow'

const base: Job = {
  id: 'j1', url: 'https://x.test/v', source: 'YouTube', title: 'A great video', thumbnail: null, kind: 'video',
  options: { kind: 'video', quality: 'h1080', container: 'mp4', audio_format: 'mp3', audio_bitrate: 0, subtitles: false, subtitle_langs: ['en'], auto_subtitles: false, embed_metadata: true, embed_thumbnail: true },
  status: 'downloading', priority: 0, progress: 0.42, downloaded_bytes: 42 * 1024 * 1024, total_bytes: 100 * 1024 * 1024,
  speed: 2 * 1024 * 1024, eta: 29, stage: 'downloading', error: null, error_code: null, attempts: 1, playlist_title: null,
  media_id: null, scheduled_at: null, created_at: 1, updated_at: 1, started_at: 1, finished_at: null,
}

const renderRow = (j: Partial<Job>) =>
  render(
    <MemoryRouter>
      <ul>
        <JobRow job={{ ...base, ...j }} />
      </ul>
    </MemoryRouter>,
  )

afterEach(() => vi.restoreAllMocks())

describe('JobRow', () => {
  it('shows live progress, speed and ETA for an active download', () => {
    renderRow({})
    expect(screen.getByText('A great video')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText(/42.0 MB of 100 MB · 2.0 MB\/s · 29s left/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('shows processing stages without a fake percentage', () => {
    renderRow({ status: 'processing', stage: 'merging' })
    expect(screen.getByText('Merging video and audio…')).toBeInTheDocument()
    expect(screen.queryByText('42%')).not.toBeInTheDocument()
  })

  it('offers retry for failures and calls the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...base, status: 'queued' }), { status: 200 }))
    renderRow({ status: 'failed', error: 'A network error interrupted the download.', error_code: 'network' })
    expect(screen.getByText('A network error interrupted the download.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/downloads/j1/retry')
  })

  it('shows play for completed downloads', () => {
    renderRow({ status: 'completed', media_id: 'm1', finished_at: Date.now() / 1000 })
    expect(screen.getByRole('button', { name: 'Watch' })).toBeInTheDocument()
  })
})
