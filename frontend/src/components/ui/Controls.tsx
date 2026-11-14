import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }>(
  function Input({ className, leading, ...rest }, ref) {
    return (
      <div className={cn('relative flex items-center', className)}>
        {leading && <span className="pointer-events-none absolute left-3 text-fg-3">{leading}</span>}
        <input
          ref={ref}
          className={cn(
            'h-10 w-full rounded-md bg-surface-2 px-3 text-sm text-fg placeholder:text-fg-3 outline-none ring-1 ring-inset ring-transparent transition',
            'hover:ring-line-strong focus:bg-surface-1 focus:ring-accent',
            !!leading && 'pl-9',
          )}
          {...rest}
        />
      </div>
    )
  },
)

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select
        className="h-10 w-full appearance-none rounded-md bg-surface-2 pl-3 pr-9 text-sm text-fg outline-none ring-1 ring-inset ring-transparent hover:ring-line-strong focus:ring-accent"
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" />
    </div>
  )
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-4 py-2.5', disabled && 'cursor-not-allowed opacity-50')}>
      <span>
        <span className="block text-sm text-fg">{label}</span>
        {description && <span className="block text-[12px] text-fg-3">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-accent' : 'bg-surface-3')}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
    </label>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  hint?: string
  disabled?: boolean
}

/** Segmented control used for tabs (Video/Audio) and compact choices. */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md', ariaLabel }: { value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; className?: string; size?: 'sm' | 'md'; ariaLabel: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('inline-flex rounded-lg bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:opacity-40',
            size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3.5 text-[13px]',
            value === o.value ? 'bg-surface-1 text-fg shadow-sm ring-1 ring-line' : 'text-fg-2 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Selectable option chip (quality and format pickers). */
export function Chip({ selected, onClick, children, sub, disabled }: { selected: boolean; onClick: () => void; children: ReactNode; sub?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-w-[76px] flex-col items-start rounded-md px-3 py-2 text-left transition-colors duration-150 disabled:opacity-40',
        selected ? 'bg-accent-soft ring-1 ring-inset ring-accent' : 'bg-surface-2 hover:bg-surface-3',
      )}
    >
      <span className={cn('text-[13px] font-semibold tabular', selected ? 'text-accent' : 'text-fg')}>{children}</span>
      {sub && <span className="text-[11px] text-fg-3 tabular">{sub}</span>}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-fg-3">{hint}</span>}
    </label>
  )
}
