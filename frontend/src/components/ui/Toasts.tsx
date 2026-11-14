import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useUi } from '../../stores/ui'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6 md:left-auto md:right-6 md:items-end"
    >
      {toasts.map((t) => {
        const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'danger' ? CircleAlert : Info
        return (
          <div
            key={t.id}
            role={t.tone === 'danger' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg bg-surface-2 p-3 pr-2 shadow-pop animate-rise"
          >
            <Icon size={18} className={cn('mt-0.5 shrink-0', t.tone === 'success' ? 'text-success' : t.tone === 'danger' ? 'text-danger' : 'text-fg-2')} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-fg">{t.title}</p>
              {t.body && <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-2">{t.body}</p>}
            </div>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
                className="shrink-0 rounded-md px-2 py-1 text-[13px] font-semibold text-accent hover:bg-accent-soft"
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-fg-3 hover:text-fg">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
