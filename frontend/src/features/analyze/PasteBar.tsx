import { useEffect, useRef } from 'react'
import { ChevronDown, ClipboardPaste, Link2, ListPlus, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Controls'
import { cn } from '../../lib/cn'
import { readClipboardUrl, supports } from '../../lib/platform'
import { toast } from '../../stores/ui'
import { countHeaders, urlFromCurl, useAnalysis } from './analysisStore'

/** The primary entry point: paste a link, press Enter. */
export function PasteBar({ autoFocus }: { autoFocus?: boolean }) {
  const {
    url, setUrl, analyze, status, reset,
    headersOpen, setHeadersOpen, referer, setReferer, headerText, setHeaderText,
  } = useAnalysis()
  const inputRef = useRef<HTMLInputElement>(null)
  const headerCount = countHeaders(referer, headerText)

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

  /** "Copy as cURL" from the browser's Network tab carries both the stream URL and its headers. */
  const takeCurl = (text: string): boolean => {
    const found = urlFromCurl(text)
    if (!found) return false
    setHeaderText(text.trim())
    setHeadersOpen(true)
    setUrl(found)
    analyze(found)
    return true
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        analyze()
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
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
              if (takeCurl(text)) {
                e.preventDefault()
              } else if (/^\s*https?:\/\//.test(text)) {
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
      </div>

      <div>
        <button
          type="button"
          onClick={() => setHeadersOpen(!headersOpen)}
          aria-expanded={headersOpen}
          aria-controls="request-headers"
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-fg-2 hover:bg-surface-2 hover:text-fg"
        >
          <ListPlus size={15} />
          Request headers
          {headerCount > 0 && (
            <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent tabular">{headerCount}</span>
          )}
          <ChevronDown size={14} className={cn('transition-transform', headersOpen && 'rotate-180')} />
        </button>

        {headersOpen && (
          <div id="request-headers" className="mt-2 grid gap-3 rounded-lg bg-surface-1 p-4 ring-1 ring-inset ring-line animate-rise">
            <p className="text-[12px] text-fg-3">
              For streams that only play on their own site, like a raw <code className="text-fg-2">.m3u8</code> link.
              They're sent with every request for this link and kept with the download, so pause, resume and retry still work.
            </p>
            <Field label="Referer (optional)">
              <Input
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://site-the-video-plays-on.com/page"
                value={referer}
                onChange={(e) => setReferer(e.target.value)}
              />
            </Field>
            <Field
              label="Other headers (optional)"
              hint={<>One <code>Name: value</code> per line, or paste a whole “Copy as cURL” from the browser's Network tab. Ctrl+Enter to read the link.</>}
            >
              <textarea
                rows={4}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={'Origin: https://site-the-video-plays-on.com\nUser-Agent: Mozilla/5.0 …\nAuthorization: Bearer …'}
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                onPaste={(e) => {
                  // A cURL pasted here also brings its URL when the link field is still empty.
                  const text = e.clipboardData.getData('text')
                  if (!url.trim() && takeCurl(text)) e.preventDefault()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    analyze()
                  }
                }}
                className={cn(
                  'block w-full resize-y rounded-md bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg placeholder:text-fg-3 outline-none',
                  'ring-1 ring-inset ring-transparent transition hover:ring-line-strong focus:bg-surface-1 focus:ring-accent',
                )}
              />
            </Field>
            {headerCount > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setReferer('')
                    setHeaderText('')
                  }}
                  className="text-[12px] font-medium text-fg-3 hover:text-fg"
                >
                  Clear headers
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  )
}
