import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Trash2, Upload } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge, Skeleton } from '../../components/ui/Feedback'
import { api } from '../../lib/api'
import { isDesktop } from '../../lib/platform'
import type { CookieStatus } from '../../lib/types'
import { toast, toastError } from '../../stores/ui'

/** Upload a Netscape cookies.txt so the server can fetch age-restricted or private media. */
export function CookiesSection() {
  const [status, setStatus] = useState<CookieStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()

  useEffect(() => {
    api.cookies().then(setStatus, () => setStatus(null))
  }, [])
  useEffect(() => {
    if (hash === '#cookies') rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [hash])

  async function upload(file: File) {
    setBusy(true)
    try {
      const next = await api.saveCookies(await file.text())
      setStatus(next)
      const signIns = [next.youtube && 'YouTube', next.google && 'Google Drive'].filter(Boolean)
      toast({
        tone: 'success',
        title: 'Cookies saved',
        body: signIns.length ? `Signed in for ${signIns.join(' and ')}.` : `${next.count} cookies for ${next.sites.slice(0, 3).join(', ')}.`,
      })
    } catch (e) {
      toastError(e, "Couldn't use that file")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div ref={rootRef} id="cookies" className="space-y-4 scroll-mt-24">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {status === null ? (
          <Skeleton className="h-5 w-32" />
        ) : status.present ? (
          <>
            <Badge tone="success">Active</Badge>
            <span className="text-fg-2">
              {status.count} cookies · {status.sites.slice(0, 4).join(', ')}
              {status.sites.length > 4 ? ` +${status.sites.length - 4}` : ''}
            </span>
          </>
        ) : (
          <Badge>Not set</Badge>
        )}
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-fg-2">
        <li>Open a <strong>private/incognito window</strong> and sign in to the site (e.g. YouTube or Google Drive) with an account that can watch the video.</li>
        <li>Export cookies in Netscape <code className="font-mono">cookies.txt</code> format, e.g. with the “Get cookies.txt LOCALLY” browser extension.</li>
        <li>Close that private window (so the site doesn't rotate the cookies), then upload the file here.</li>
      </ol>
      <p className="text-[12px] text-fg-3">{isDesktop() ? 'The file stays on this computer.' : 'The file stays on your VidBuddy server and is never sent back to the app.'} Treat it like a password. Remove it any time.</p>

      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button variant="primary" icon={<Upload size={14} />} disabled={busy} onClick={() => fileRef.current?.click()}>
          {status?.present ? 'Replace cookies.txt' : 'Upload cookies.txt'}
        </Button>
        {status?.present && (
          <Button
            variant="ghost"
            icon={<Trash2 size={14} />}
            disabled={busy}
            onClick={async () => {
              try {
                setStatus(await api.clearCookies())
                toast({ tone: 'neutral', title: 'Cookies removed' })
              } catch (e) {
                toastError(e, "Couldn't remove cookies")
              }
            }}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}
