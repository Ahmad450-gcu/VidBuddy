import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Download, Headphones, History, Layers, MonitorSmartphone, Music2, Play, ShieldCheck, Sparkles } from 'lucide-react'
import { Logo } from '../../components/layout/Logo'
import { ProgressBar } from '../../components/ui/Feedback'
import { Thumb } from '../../components/ui/Thumb'
import { formatBytes, formatDuration, formatSpeed } from '../../lib/format'
import type { MediaItem } from '../../lib/types'
import { groupJobs, useDownloads } from '../../stores/downloads'
import { AnalysisPanel } from '../analyze/AnalysisPanel'
import { useAnalysis } from '../analyze/analysisStore'
import { PasteBar } from '../analyze/PasteBar'
import { playItem } from '../library/actions'
import { useMediaList } from '../library/useMedia'

const SITES = ['YouTube', 'TikTok', 'Instagram', 'X', 'Vimeo', 'SoundCloud', 'Reddit', 'Twitch', 'Dailymotion', 'Bandcamp']

export function HomePage() {
  const [params, setParams] = useSearchParams()
  const { analyze, setUrl, status, recent, loadRecent } = useAnalysis()
  const navigate = useNavigate()

  // Links arriving from the share target or a ?url= deep link
  useEffect(() => {
    const incoming = params.get('url')
    if (incoming) {
      setUrl(incoming)
      analyze(incoming)
      setParams({}, { replace: true })
    }
  }, [params, analyze, setUrl, setParams])

  useEffect(() => {
    loadRecent()
  }, [loadRecent])

  // Paste a link anywhere on the page (not only in the field) to start.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const text = e.clipboardData?.getData('text')?.trim() ?? ''
      if (/^https?:\/\/\S+$/.test(text)) {
        e.preventDefault()
        setUrl(text)
        analyze(text)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [analyze, setUrl])

  const jobs = useDownloads((s) => s.jobs)
  const active = useMemo(() => groupJobs(jobs).active.slice(0, 3), [jobs])
  const { items: recentMedia } = useMediaList({ sort: 'created', order: 'desc', limit: 8 })
  const { items: played } = useMediaList({ sort: 'played', order: 'desc', limit: 12 })
  const continuing = useMemo(
    () => played.filter((m) => m.status === 'ready' && m.play_position > 5 && (!m.duration || m.play_position < m.duration - 10)).slice(0, 4),
    [played],
  )
  const idle = status === 'idle'
  const empty = recentMedia.length === 0 && active.length === 0

  return (
    <div className="relative mx-auto max-w-5xl px-4 pb-12 md:px-8">
      {/* soft brand glow behind the hero */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 h-[420px] bg-[radial-gradient(60%_60%_at_50%_30%,var(--accent-soft),transparent_70%)]" />

      <div className="relative flex items-center gap-2.5 pt-5 md:hidden">
        <Logo size={28} />
        <span className="text-[17px] font-semibold tracking-tight">VidBuddy</span>
      </div>

      <section className="relative pt-8 md:pt-16">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-1/80 px-3 py-1 text-[12px] font-medium text-fg-2 ring-1 ring-line backdrop-blur">
            <Sparkles size={13} className="text-accent" />
            Free, private, no ads
          </span>
          <h1 className="mt-4 text-[30px] font-semibold leading-[1.1] tracking-tight md:text-[44px]">
            Save any video.
            <br />
            <span className="text-accent">Watch it anywhere.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[14px] text-fg-2 md:text-[15px]">
            Paste a link to a video, song or playlist. VidBuddy finds every quality, from 8K video to MP3.
          </p>
        </div>

        <div className="mx-auto mt-7 max-w-3xl rounded-2xl bg-surface-1/70 p-2 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.6)] ring-1 ring-line backdrop-blur md:p-2.5">
          <PasteBar autoFocus />
        </div>

        <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center justify-center gap-1.5">
          {idle && recent.length > 0 ? (
            <>
              <History size={13} className="mr-0.5 text-fg-3" />
              {recent.slice(0, 4).map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setUrl(r)
                    analyze(r)
                  }}
                  className="max-w-[240px] truncate rounded-full bg-surface-1 px-3 py-1 text-[12px] text-fg-2 ring-1 ring-line transition-colors hover:text-fg hover:ring-line-strong"
                  title={r}
                >
                  {r.replace(/^https?:\/\/(www\.)?/, '')}
                </button>
              ))}
            </>
          ) : (
            idle && (
              <>
                <span className="mr-1 text-[12px] text-fg-3">Works with</span>
                {SITES.map((s) => (
                  <span key={s} className="rounded-full bg-surface-1 px-2.5 py-0.5 text-[12px] text-fg-2 ring-1 ring-line">
                    {s}
                  </span>
                ))}
                <span className="ml-1 text-[12px] text-fg-3">and 1,700+ more</span>
              </>
            )
          )}
        </div>
      </section>

      <div className="relative mx-auto mt-8 max-w-3xl">
        <AnalysisPanel />
      </div>

      {active.length > 0 && (
        <section className="relative mt-12">
          <SectionTitle title="Downloading now" to="/downloads" />
          <ul className="space-y-2">
            {active.map((j) => (
              <li key={j.id} className="flex items-center gap-3 rounded-xl bg-surface-1 p-2.5 ring-1 ring-line">
                <Thumb src={j.thumbnail} kind={j.kind} className="aspect-video w-20" showDuration={false} iconSize={14} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{j.title ?? j.url}</p>
                  <ProgressBar value={j.progress} indeterminate={j.status === 'processing' || !j.progress} className="mt-2" label="Progress" />
                </div>
                <span className="w-20 text-right text-[12px] text-fg-3 tabular">
                  {j.status === 'processing' ? 'Processing' : j.speed ? formatSpeed(j.speed) : formatBytes(j.downloaded_bytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {continuing.length > 0 && (
        <section className="relative mt-12">
          <SectionTitle title="Continue watching" to="/library?view=recent" />
          <MediaGrid items={continuing} siblings={continuing} onOpen={(m, list) => playItem(m, list, navigate)} showProgress />
        </section>
      )}

      {recentMedia.length > 0 && (
        <section className="relative mt-12">
          <SectionTitle title="Recently added" to="/library" />
          <MediaGrid items={recentMedia} siblings={recentMedia} onOpen={(m, list) => playItem(m, list, navigate)} />
        </section>
      )}

      {idle && (
        <section className={empty ? 'relative mt-14' : 'relative mt-14 border-t border-line pt-10'}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Download, title: 'Any quality', body: 'Up to 8K video, or just the audio as MP3, M4A, Opus or FLAC.' },
              { icon: Layers, title: 'Whole playlists', body: 'Pick the items you want, queue them, even schedule for tonight.' },
              { icon: Headphones, title: 'Video as audio', body: 'Play any video in the background like a song, or save its MP3.' },
              { icon: MonitorSmartphone, title: 'Every device', body: 'Install it as an app on your phone, tablet or computer.' },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl bg-surface-1 p-4 ring-1 ring-line">
                <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent">
                  <Icon size={18} />
                </span>
                <p className="mt-3 text-[13.5px] font-semibold">{title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[12px] text-fg-3">
            <ShieldCheck size={13} />
            Downloads stay on your own server. Only save content you have the right to.
          </p>
        </section>
      )}
    </div>
  )
}

function MediaGrid({ items, siblings, onOpen, showProgress }: { items: MediaItem[]; siblings: MediaItem[]; onOpen: (m: MediaItem, list: MediaItem[]) => void; showProgress?: boolean }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible md:px-0">
      {items.map((m) => (
        <button key={m.id} onClick={() => onOpen(m, siblings)} className="group w-44 shrink-0 text-left md:w-auto">
          <div className="relative overflow-hidden rounded-lg ring-1 ring-line">
            <Thumb item={m} rounded="rounded-none" className="aspect-video w-full transition-transform duration-300 group-hover:scale-[1.03]" />
            <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/35">
              <span className="grid size-11 scale-90 place-items-center rounded-full bg-accent text-accent-fg opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
                {m.kind === 'audio' ? <Music2 size={18} /> : <Play size={18} className="ml-0.5 fill-current" />}
              </span>
            </span>
            {showProgress && m.duration ? (
              <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (m.play_position / m.duration) * 100)}%` }} />
              </span>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{m.title}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-fg-3">
            {m.uploader ?? m.source}
            {showProgress && m.duration ? ` · ${formatDuration(Math.max(0, m.duration - m.play_position))} left` : ''}
          </p>
        </button>
      ))}
    </div>
  )
}

function SectionTitle({ title, to }: { title: string; to: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      <Link to={to} className="flex items-center gap-1 text-[12.5px] font-medium text-fg-3 hover:text-fg">
        See all <ArrowRight size={13} />
      </Link>
    </div>
  )
}
