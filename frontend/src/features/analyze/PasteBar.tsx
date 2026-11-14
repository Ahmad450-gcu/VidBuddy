import { useEffect, useRef } from 'react'
import { ClipboardPaste, Link2, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { readClipboardUrl, supports } from '../../lib/platform'
import { toast } from '../../stores/ui'
import { useAnalysis } from './analysisStore'

/** The primary entry point: paste a link, press Enter. */
export function PasteBar({ autoFocus }: { autoFocus?: boolean }) {
  const { url, setUrl, analyze, status, reset } = useAnalysis()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Desktop: focus immediately. Touch: skip, since it would pop the keyboard over the page.
    if (autoFocus && !supports.touch) inputRef.current?.focus()
  }, [autoFocus])

  const paste = async () => {
    const found = await readClipboardUrl()
    if (found) {
      setUrl(found)
      analyze(found)
    } else {
      inputRef.current?.focus()
      toast({ tone: 'neutral', title: 'No link on the clipboard', body: 'Copy a link first, or paste it into the field.' })
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        analyze()
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <div
        className={cn(
          'group relative flex h-12 flex-1 items-center rounded-lg bg-surface-1 ring-1 ring-inset ring-line-strong transition-shadow',
          'focus-within:ring-2 focus-within:ring-accent',
        )}
      >
        <Link2 size={18} className="pointer-events-none ml-4 shrink-0 text-fg-3" />
        <input
          ref={inputRef}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-label="Media link"
          placeholder="Paste a link from YouTube, Vimeo, SoundCloud, or 1,700+ sites"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (/^\s*https?:\/\//.test(text)) {
              e.preventDefault()
              const clean = text.trim()
              setUrl(clean)
              analyze(clean)
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] text-fg placeholder:text-fg-3 outline-none"
        />
        {url ? (
          <button type="button" onClick={reset} aria-label="Clear" className="mr-2 rounded-md p-2 text-fg-3 hover:text-fg">
            <X size={16} />
          </button>
        ) : (
          supports.clipboardRead && (
            <button
              type="button"
              onClick={paste}
              className="mr-1.5 flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-fg-2 hover:bg-surface-2 hover:text-fg"
            >
              <ClipboardPaste size={15} />
              Paste
            </button>
          )
        )}
      </div>
      <Button type="submit" variant="primary" size="lg" loading={status === 'loading'} disabled={!url.trim()} className="sm:w-32">
        {status === 'loading' ? 'Reading…' : 'Get media'}
      </Button>
    </form>
  )
}
