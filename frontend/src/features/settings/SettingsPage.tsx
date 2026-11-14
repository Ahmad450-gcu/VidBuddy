import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Download, FolderHeart, HardDrive, Monitor, Moon, Settings as SettingsIcon, Sun } from 'lucide-react'
import { Logo, PageHeader } from '../../components/layout/Logo'
import { Button } from '../../components/ui/Button'
import { Field, Input, Segmented, Select, Switch } from '../../components/ui/Controls'
import { Badge, Skeleton } from '../../components/ui/Feedback'
import { api, connection } from '../../lib/api'
import { install, supports } from '../../lib/platform'
import type { AudioFormat, Container, MediaKind, Preferences, SystemInfo } from '../../lib/types'
import { usePrefs } from '../../stores/prefs'
import { CookiesSection } from './CookiesSection'
import { toast, toastError, useUi, type Theme } from '../../stores/ui'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-6 md:grid-cols-[220px_1fr] md:gap-10">
      <div>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] text-fg-3">{description}</p>}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Space / K', 'Play or pause'],
  ['J / L', 'Back / forward 10 s'],
  ['← / →', 'Back / forward 5 s'],
  ['↑ / ↓', 'Volume'],
  ['F', 'Full screen'],
  ['M', 'Mute'],
  ['C', 'Subtitles'],
  ['P', 'Picture-in-picture'],
  ['< / >', 'Playback speed'],
  ['Shift+N / Shift+P', 'Next / previous video'],
  ['0–9', 'Jump to 0–90%'],
  ['/', 'Search the library'],
]

function previewTemplate(t: string) {
  const sample: Record<string, string> = {
    title: 'Sunset Timelapse 4K', id: 'dQw4w9WgXcQ', uploader: 'Nature Films', channel: 'Nature Films', upload_date: '20260412',
    extractor: 'youtube', resolution: '1920x1080', height: '1080', fps: '30', playlist_title: 'Favourites', playlist_index: '3',
    ext: 'mp4', duration_string: '3:41', artist: 'Nature Films', album: 'Timelapses',
  }
  return t.replace(/%\(([^)]+)\)(0?\d*)?[sd]/g, (_, f: string) => sample[f] ?? `{${f}}`)
}

export function SettingsPage() {
  const { prefs, loaded, save, load } = usePrefs()
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [template, setTemplate] = useState(prefs.filename_template)
  const [server, setServer] = useState(connection.base)
  const [token, setToken] = useState(connection.token)
  const [canInstall, setCanInstall] = useState(install.available)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    api.system().then(setSys, () => undefined)
    if (!loaded) load().catch(() => undefined)
    navigator.storage?.persisted?.().then(setPersisted, () => undefined)
    const unsub = install.subscribe(setCanInstall)
    return () => {
      unsub()
    }
  }, [loaded, load])
  useEffect(() => setTemplate(prefs.filename_template), [prefs.filename_template])

  const update = async (patch: Partial<Preferences>) => {
    try {
      await save(patch)
    } catch (e) {
      toastError(e, "Couldn't save the setting")
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" subtitle="Preferences are stored on your VidBuddy server and shared by all your devices." />
      <div className="px-4 pb-12 md:px-8">
        <Section title="Appearance" description="Theme is remembered on this device.">
          <Segmented<Theme>
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: <><Monitor size={14} /> System</> },
              { value: 'dark', label: <><Moon size={14} /> Dark</> },
              { value: 'light', label: <><Sun size={14} /> Light</> },
            ]}
          />
        </Section>

        <Section title="Download defaults" description="Pre-selected whenever you open a link. You can still change them per download.">
          {!loaded ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Default type">
                  <Select value={prefs.default_kind} onChange={(e) => update({ default_kind: e.target.value as MediaKind })}>
                    <option value="video">Video</option>
                    <option value="audio">Audio only</option>
                  </Select>
                </Field>
                <Field label="Preferred video quality" hint="Falls back to the next best when unavailable.">
                  <Select value={prefs.default_quality} onChange={(e) => update({ default_quality: e.target.value })}>
                    <option value="best">Best available</option>
                    <option value="h2160">4K (2160p)</option>
                    <option value="h1440">1440p</option>
                    <option value="h1080">1080p</option>
                    <option value="h720">720p</option>
                    <option value="h480">480p</option>
                    <option value="h360">360p</option>
                  </Select>
                </Field>
                <Field label="Video format">
                  <Select value={prefs.default_container} onChange={(e) => update({ default_container: e.target.value as Container })}>
                    <option value="mp4">MP4 (most compatible)</option>
                    <option value="webm">WebM</option>
                    <option value="mkv">MKV</option>
                  </Select>
                </Field>
                <Field label="Audio format">
                  <Select value={prefs.default_audio_format} onChange={(e) => update({ default_audio_format: e.target.value as AudioFormat })}>
                    {(['mp3', 'm4a', 'aac', 'opus', 'flac', 'wav'] as const).map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Audio bitrate">
                  <Select value={prefs.default_audio_bitrate} onChange={(e) => update({ default_audio_bitrate: Number(e.target.value) })}>
                    <option value={0}>Best (VBR)</option>
                    {[96, 128, 192, 256, 320].map((b) => (
                      <option key={b} value={b}>
                        {b} kbps
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Subtitle language" hint="Two-letter code, e.g. en, es, de.">
                  <Input
                    defaultValue={prefs.subtitle_langs.join(', ')}
                    onBlur={(e) => {
                      const langs = e.target.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
                      if (langs.join() !== prefs.subtitle_langs.join()) update({ subtitle_langs: langs.length ? langs : ['en'] })
                    }}
                  />
                </Field>
              </div>
              <div className="divide-y divide-line">
                <Switch checked={prefs.subtitles} onChange={(v) => update({ subtitles: v })} label="Download subtitles when available" />
                <Switch checked={prefs.embed_metadata} onChange={(v) => update({ embed_metadata: v })} label="Write metadata into files" description="Title, artist, date and chapters" />
                <Switch checked={prefs.embed_thumbnail} onChange={(v) => update({ embed_thumbnail: v })} label="Embed cover art in audio files" />
              </div>
            </>
          )}
        </Section>

        <Section title="File names" description="Uses yt-dlp template fields. Folders and other fields are rejected for safety.">
          <Field
            label="Template"
            hint={
              <>
                Fields: title, id, uploader, channel, upload_date, playlist_title, playlist_index, resolution, height, fps, artist, album, duration_string
              </>
            }
          >
            <div className="flex gap-2">
              <Input value={template} onChange={(e) => setTemplate(e.target.value)} className="flex-1 font-mono" spellCheck={false} />
              <Button
                variant="primary"
                disabled={template === prefs.filename_template}
                onClick={async () => {
                  try {
                    await save({ filename_template: template })
                    toast({ tone: 'success', title: 'Template saved' })
                  } catch (e) {
                    toastError(e, 'Invalid template')
                  }
                }}
              >
                Save
              </Button>
            </div>
          </Field>
          <p className="rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg-2">{previewTemplate(template.endsWith('.%(ext)s') ? template : `${template}.%(ext)s`)}</p>
        </Section>

        <Section title="Download manager" description="How many downloads run at the same time. Others wait in the queue.">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={1}
              max={10}
              value={prefs.max_concurrent}
              onChange={(e) => update({ max_concurrent: Number(e.target.value) })}
              aria-label="Simultaneous downloads"
              className="haul-range on-surface max-w-xs flex-1"
              style={{ '--pct': `${((prefs.max_concurrent - 1) / 9) * 100}%` } as React.CSSProperties}
            />
            <span className="w-24 text-[13px] font-medium tabular">{prefs.max_concurrent} at once</span>
          </div>
        </Section>

        <Section title="Sign-in cookies" description="Needed for age-restricted, private or members-only media that your account can watch.">
          <CookiesSection />
        </Section>

        <Section title="Server" description="Leave empty when this app is served by your VidBuddy server. Set it when using the app from another address.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Server address" hint="e.g. https://haul.example.com">
              <Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="Same as this page" inputMode="url" />
            </Field>
            <Field label="Access token" hint={sys?.auth ? 'Required by this server.' : 'Only if HAUL_API_TOKEN is set on the server.'}>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Button
            onClick={async () => {
              connection.set(token.trim(), server.trim())
              try {
                await api.health()
                toast({ tone: 'success', title: 'Connected' })
                window.location.reload()
              } catch (e) {
                toastError(e, "Couldn't connect with these settings")
              }
            }}
          >
            Save and reconnect
          </Button>
        </Section>

        <Section title="This device">
          <div className="space-y-3 text-[13px]">
            <Row label="Installed as an app">{supports.standalone ? <Badge tone="success">Yes</Badge> : canInstall ? <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={() => install.prompt()}>Install VidBuddy</Button> : <span className="text-fg-3">{supports.ios ? 'Share › Add to Home Screen in Safari' : 'Use your browser menu › Install'}</span>}</Row>
            <Row label="Save files with native dialog">{supports.fileSystemAccess ? <Badge tone="success">Supported</Badge> : <span className="text-fg-3">Browser downloads are used instead</span>}</Row>
            <Row label="Picture-in-picture">{supports.pictureInPicture ? <Badge tone="success">Supported</Badge> : <span className="text-fg-3">Not supported</span>}</Row>
            <Row label="Lock-screen controls">{supports.mediaSession ? <Badge tone="success">Supported</Badge> : <span className="text-fg-3">Not supported</span>}</Row>
            <Row label="Keep app data on this device">
              {persisted ? (
                <Badge tone="success">Persistent</Badge>
              ) : navigator.storage?.persist ? (
                <Button size="sm" onClick={async () => setPersisted(await navigator.storage.persist())}>
                  Request
                </Button>
              ) : (
                <span className="text-fg-3">Not available</span>
              )}
            </Row>
          </div>
        </Section>

        <Section title="Keyboard shortcuts" description="In the video player on desktop.">
          <dl className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-fg-2">{v}</dt>
                <dd>
                  <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg ring-1 ring-line-strong">{k}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Engine" description="VidBuddy uses yt-dlp for extraction and FFmpeg for processing. Update the server when a site stops working.">
          {!sys ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <dl className="divide-y divide-line rounded-lg bg-surface-1 px-4 text-[12.5px] ring-1 ring-line">
              <Row label="yt-dlp">{sys.engine.yt_dlp}</Row>
              <Row label="Supported extractors">{sys.supported_site_count.toLocaleString()}</Row>
              <Row label="FFmpeg">{sys.engine.ffmpeg ? <Badge tone="success">Available</Badge> : <Badge tone="danger">Missing</Badge>}</Row>
              <Row label="JavaScript runtime">{sys.engine.js_runtime ?? <span className="text-danger">None (YouTube formats limited)</span>}</Row>
              <Row label="Browser impersonation">{sys.engine.curl_cffi ? `curl_cffi ${sys.engine.curl_cffi}` : 'Unavailable'}</Row>
              <Row label="Media folder"><span className="break-all font-mono">{sys.media_root}</span></Row>
            </dl>
          )}
        </Section>

        <div className="flex items-center gap-3 border-t border-line pt-6 text-[12px] text-fg-3">
          <Logo size={20} />
          VidBuddy 1.0. No ads, no tracking. Only download content you have the right to.
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-fg-2">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

export function MorePage() {
  const links = [
    { to: '/library?view=favorites', label: 'Favorites', icon: FolderHeart },
    { to: '/storage', label: 'Storage', icon: HardDrive },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ]
  return (
    <div>
      <PageHeader title="More" />
      <ul className="mx-4 divide-y divide-line overflow-hidden rounded-xl bg-surface-1 ring-1 ring-line">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex h-14 items-center gap-3 px-4 text-[14px] active:bg-surface-2">
              <l.icon size={18} className="text-fg-2" />
              <span className="flex-1">{l.label}</span>
              <ChevronRight size={16} className="text-fg-3" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
