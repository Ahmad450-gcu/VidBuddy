import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Clock, History } from 'lucide-react'
import { Logo } from '../../components/layout/Logo'
import { ProgressBar } from '../../components/ui/Feedback'
import { Thumb } from '../../components/ui/Thumb'
import { formatBytes, formatSpeed } from '../../lib/format'
import { groupJobs, useDownloads } from '../../stores/downloads'
import { AnalysisPanel } from '../analyze/AnalysisPanel'
import { useAnalysis } from '../analyze/analysisStore'
import { PasteBar } from '../analyze/PasteBar'
import { playItem } from '../library/actions'
import { useMediaList } from '../library/useMedia'

const EXAMPLES = ['YouTube', 'Vimeo', 'SoundCloud', 'Dailymotion', 'Bandcamp', 'TikTok', 'X', 'Reddit', 'Twitch clips', 'Internet Archive']

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

  const jobs = useDownloads((s) => s.jobs)
  const active = useMemo(() => groupJobs(jobs).active.slice(0, 3), [jobs])
  const { items: recentMedia } = useMediaList({ sort: 'created', order: 'desc', limit: 8 })
  const showDiscovery = status === 'idle'

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 md:px-8">
      <div className="flex items-center gap-2.5 pt-5 md:hidden">
        <Logo size={26} />
        <span className="text-[16px] font-semibold tracking-tight">Haul</span>
      </div>

      <section className="pt-8 md:pt-14">
        <h1 className="text-[22px] font-semibold tracking-tight md:text-[26px]">What do you want to keep?</h1>
        <p className="mb-5 mt-1 text-[13.5px] text-fg-2">Paste a link to a video, song, or playlist. Haul finds every available quality.</p>
        <PasteBar autoFocus />
        {showDiscovery && recent.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <History size={13} className="mr-0.5 text-fg-3" />
            {recent.slice(0, 4).map((r) => (
              <button
                key={r}
                onClick={() => {
                  setUrl(r)
                  analyze(r)
                }}
                className="max-w-[240px] truncate rounded-full bg-surface-1 px-2.5 py-1 text-[12px] text-fg-2 ring-1 ring-line hover:text-fg"
                title={r}
              >
                {r.replace(/^https?:\/\/(www\.)?/, '')}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6">
        <AnalysisPanel />
      </div>

      {active.length > 0 && (
        <section className="mt-10">
          <SectionTitle title="Downloading now" to="/downloads" />
          <ul className="space-y-1">
            {active.map((j) => (
              <li key={j.id} className="flex items-center gap-3 rounded-lg px-1 py-2">
                <Thumb src={j.thumbnail} kind={j.kind} className="aspect-video w-16" showDuration={false} iconSize={14} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{j.title ?? j.url}</p>
                  <ProgressBar value={j.progress} indeterminate={j.status === 'processing' || !j.progress} className="mt-1.5" label="Progress" />
                </div>
                <span className="w-20 text-right text-[12px] text-fg-3 tabular">
                  {j.status === 'processing' ? 'Processing' : j.speed ? formatSpeed(j.speed) : formatBytes(j.downloaded_bytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recentMedia.length > 0 && (
        <section className="mt-10">
          <SectionTitle title="Recently added" to="/library?view=recent" />
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
            {recentMedia.map((m) => (
              <button key={m.id} onClick={() => playItem(m, recentMedia, navigate)} className="group w-40 shrink-0 text-left md:w-auto">
                <Thumb item={m} className="aspect-video w-full transition-opacity group-hover:opacity-85" />
                <p className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-snug">{m.title}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-fg-3">{m.uploader ?? m.source}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {showDiscovery && recentMedia.length === 0 && active.length === 0 && (
        <section className="mt-12 grid gap-3 sm:grid-cols-3">
          {[
            ['Pick your quality', 'Up to 8K video, or extract audio to MP3, M4A, Opus, FLAC and more.'],
            ['Download in bulk', 'Grab whole playlists, choose items, schedule for tonight.'],
            ['Watch anywhere', 'Everything lands in a library you can play on any device.'],
          ].map(([t, b]) => (
            <div key={t} className="rounded-lg bg-surface-1 p-4 ring-1 ring-line">
              <p className="text-[13px] font-semibold">{t}</p>
              <p className="mt-1 text-[12.5px] text-fg-2">{b}</p>
            </div>
          ))}
          <p className="text-[12px] text-fg-3 sm:col-span-3">
            <Clock size={12} className="mr-1 inline" />
            Works with {EXAMPLES.join(', ')} and 1,700+ other sites, plus direct links to media files.
          </p>
        </section>
      )}
    </div>
  )
}

function SectionTitle({ title, to }: { title: string; to: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold text-fg-2">{title}</h2>
      <Link to={to} className="flex items-center gap-1 text-[12.5px] font-medium text-fg-3 hover:text-fg">
        See all <ArrowRight size={13} />
      </Link>
    </div>
  )
}
