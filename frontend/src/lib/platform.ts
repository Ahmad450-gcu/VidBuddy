/** Feature detection. Never assume a capability exists on every device. */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type SaveFilePicker = (opts: {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

export const supports = {
  get fileSystemAccess() {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window
  },
  get pictureInPicture() {
    return typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled
  },
  get clipboardRead() {
    return typeof navigator !== 'undefined' && !!navigator.clipboard && 'readText' in navigator.clipboard
  },
  get share() {
    return typeof navigator !== 'undefined' && 'share' in navigator
  },
  get mediaSession() {
    return typeof navigator !== 'undefined' && 'mediaSession' in navigator
  },
  get fullscreen() {
    return typeof document !== 'undefined' && (document.fullscreenEnabled || 'webkitEnterFullscreen' in HTMLVideoElement.prototype)
  },
  get standalone() {
    return (
      typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)
    )
  },
  get touch() {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  },
  get ios() {
    return typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent)
  },
}

// ------------------------------------------------------------------ install prompt
let deferredPrompt: BeforeInstallPromptEvent | null = null
const installListeners = new Set<(available: boolean) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    installListeners.forEach((l) => l(true))
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installListeners.forEach((l) => l(false))
  })
}

export const install = {
  get available() {
    return deferredPrompt !== null
  },
  subscribe(fn: (available: boolean) => void) {
    installListeners.add(fn)
    return () => installListeners.delete(fn)
  },
  async prompt(): Promise<boolean> {
    if (!deferredPrompt) return false
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    installListeners.forEach((l) => l(false))
    return outcome === 'accepted'
  },
}

// ------------------------------------------------------------------ save to device
/**
 * Save a library file to the device.
 * - File System Access API (Chromium desktop): native save dialog, and the response body is
 *   streamed straight to disk without being held in memory.
 * - Everywhere else: a normal browser download via Content-Disposition. The browser streams
 *   it to its downloads folder, and on iOS it lands in Files › Downloads.
 */
export async function saveToDevice(url: string, filename: string, mime?: string | null): Promise<'saved' | 'browser' | 'cancelled'> {
  if (supports.fileSystemAccess) {
    try {
      const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : ''
      const picker = (window as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker
      const handle = await picker({
        suggestedName: filename,
        types: mime && ext ? [{ description: 'Media file', accept: { [mime]: [ext] } }] : undefined,
      })
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const writable = await handle.createWritable()
      await res.body.pipeTo(writable)
      return 'saved'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // fall through to a regular download on any other failure
    }
  }
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  return 'browser'
}

export async function readClipboardUrl(): Promise<string | null> {
  if (!supports.clipboardRead) return null
  try {
    const text = await navigator.clipboard.readText()
    const m = text.match(/https?:\/\/[^\s<>"']+/)
    return m ? m[0] : null
  } catch {
    return null
  }
}
