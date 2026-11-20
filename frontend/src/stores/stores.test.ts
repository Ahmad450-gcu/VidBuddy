import { beforeEach, describe, expect, it } from 'vitest'
import type { Job, MediaItem } from '../lib/types'
import { groupJobs, useDownloads } from './downloads'
import { usePlayer } from './player'

const job = (id: string, status: Job['status'], extra: Partial<Job> = {}): Job =>
  ({ id, status, priority: 0, created_at: 1, updated_at: 1, started_at: null, finished_at: null, ...extra }) as Job

describe('groupJobs', () => {
  it('groups by state and orders the queue by priority', () => {
    const g = groupJobs({
      a: job('a', 'downloading'),
      b: job('b', 'queued', { priority: 0, created_at: 1 }),
      c: job('c', 'queued', { priority: 5, created_at: 2 }),
      d: job('d', 'paused'),
      e: job('e', 'completed', { finished_at: 10 }),
      f: job('f', 'cancelled'),
      g: job('g', 'processing'),
    })
    expect(g.active.map((j) => j.id).sort()).toEqual(['a', 'g'])
    expect(g.queued.map((j) => j.id)).toEqual(['c', 'b', 'd'])
    expect(g.completed.map((j) => j.id)).toEqual(['e'])
    expect(g.failed.map((j) => j.id)).toEqual(['f'])
  })
})

const track = (id: string): MediaItem => ({ id, kind: 'audio', status: 'ready', title: id }) as MediaItem

describe('audio player queue', () => {
  beforeEach(() => usePlayer.setState({ queue: [], index: -1, order: [], shuffle: false, repeat: 'off', playing: false }))

  it('plays, advances and stops at the end without repeat', () => {
    const p = usePlayer.getState()
    p.playAudio([track('1'), track('2')])
    expect(usePlayer.getState().index).toBe(0)
    usePlayer.getState().next(true)
    expect(usePlayer.getState().index).toBe(1)
    usePlayer.getState().next(true)
    expect(usePlayer.getState().playing).toBe(false)
  })

  it('repeat all wraps and repeat one stays', () => {
    usePlayer.getState().playAudio([track('1'), track('2')], 1)
    usePlayer.setState({ repeat: 'all' })
    usePlayer.getState().next(true)
    expect(usePlayer.getState().index).toBe(0)
    usePlayer.setState({ repeat: 'one' })
    usePlayer.getState().next(true)
    expect(usePlayer.getState().index).toBe(0)
  })

  it('shuffle keeps the current track first and visits every track once', () => {
    usePlayer.getState().playAudio(['1', '2', '3', '4', '5'].map(track), 2)
    usePlayer.getState().toggleShuffle()
    const { order } = usePlayer.getState()
    expect(order[0]).toBe(2)
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('enqueue skips duplicates and removeAt keeps the current track', () => {
    usePlayer.getState().playAudio([track('1'), track('2')], 1)
    usePlayer.getState().enqueue([track('2'), track('3')])
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(['1', '2', '3'])
    usePlayer.getState().removeAt(0)
    const s = usePlayer.getState()
    expect(s.queue.map((t) => t.id)).toEqual(['2', '3'])
    expect(s.queue[s.index].id).toBe('2')
  })
})

describe('download list', () => {
  it("doesn't let a late reply show a started download as queued again", () => {
    const job = { id: 'race', status: 'queued', updated_at: 100 } as Job
    const { upsert, patch } = useDownloads.getState()
    upsert(job) // "job created" event
    patch('race', { status: 'downloading', stage: 'starting', updated_at: 100.02 }) // started at once
    upsert(job) // the reply to the click arrives last, still saying "queued"
    expect(useDownloads.getState().jobs.race.status).toBe('downloading')
    upsert({ ...job, status: 'paused', updated_at: 101 }) // a genuinely newer state still applies
    expect(useDownloads.getState().jobs.race.status).toBe('paused')
  })
})
