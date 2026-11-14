import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      role="status"
      aria-label="Loading"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin', className)}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} />
}

export function ProgressBar({
  value,
  tone = 'accent',
  indeterminate,
  className,
  label,
}: {
  value: number
  tone?: 'accent' | 'success' | 'danger' | 'muted'
  indeterminate?: boolean
  className?: string
  label?: string
}) {
  const color = { accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger', muted: 'bg-fg-3' }[tone]
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      {indeterminate ? (
        <div className={cn('absolute inset-y-0 w-2/5 rounded-full', color)} style={{ animation: 'indeterminate 1.3s ease-in-out infinite' }} />
      ) : (
        <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', color)} style={{ width: `${pct}%` }} />
      )}
    </div>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'info'; className?: string }) {
  const tones = {
    neutral: 'bg-surface-3 text-fg-2',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
  }
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium leading-none tabular', tones[tone], className)}>
      {children}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  body?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center animate-fade', className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-surface-2 text-fg-3">{icon}</div>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-[13px] text-fg-2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg bg-danger-soft px-4 py-6 text-center text-[13px] text-danger">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="font-semibold underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  )
}
