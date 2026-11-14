import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Spinner } from './Feedback'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover font-semibold',
  secondary: 'bg-surface-3 text-fg hover:bg-line-strong',
  ghost: 'text-fg-2 hover:text-fg hover:bg-surface-2',
  outline: 'text-fg ring-1 ring-inset ring-line-strong hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-white font-medium',
}
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-md',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md' | 'lg'
  tone?: 'default' | 'onMedia' | 'accent'
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', tone = 'default', active, className, children, type = 'button', ...rest },
  ref,
) {
  const dims = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10'
  const tones = {
    default: cn('text-fg-2 hover:text-fg hover:bg-surface-2', active && 'text-accent hover:text-accent'),
    onMedia: cn('text-white/90 hover:text-white hover:bg-white/10', active && 'text-accent hover:text-accent'),
    accent: 'bg-accent text-accent-fg hover:bg-accent-hover',
  }
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-40',
        dims,
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
