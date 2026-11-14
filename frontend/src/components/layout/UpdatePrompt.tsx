import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'

/**
 * Service worker registration with an explicit "update available" prompt, so a new
 * version never swaps in under someone mid-playback.
 */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<null | ((reload?: boolean) => Promise<void>)>(null)
  const [offlineReady, setOfflineReady] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
    let cancelled = false
    import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return
      const updateSW = registerSW({
        onNeedRefresh: () => setUpdate(() => updateSW),
        onOfflineReady: () => setOfflineReady(true),
        onRegisteredSW: (_url, reg) => {
          if (reg) window.setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000)
        },
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!offlineReady) return
    const t = window.setTimeout(() => setOfflineReady(false), 4000)
    return () => window.clearTimeout(t)
  }, [offlineReady])

  if (!update && !offlineReady) return null
  return (
    <div role="status" className="fixed left-1/2 top-3 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-lg bg-surface-2 py-2 pl-4 pr-2 text-[13px] shadow-pop animate-rise">
      {update ? (
        <>
          <RefreshCw size={15} className="text-accent" />
          A new version of Haul is ready.
          <Button size="sm" variant="primary" onClick={() => update(true)}>
            Reload
          </Button>
        </>
      ) : (
        <span className="pr-2">Haul is ready to work offline.</span>
      )}
    </div>
  )
}
