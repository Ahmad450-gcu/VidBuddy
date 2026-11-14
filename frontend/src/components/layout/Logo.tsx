export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="18" fill="var(--accent)" />
      <path d="M25 15.5 44.5 27.5 25 39.5Z" fill="var(--accent-fg)" stroke="var(--accent-fg)" strokeWidth="4" strokeLinejoin="round" />
      <path d="M19 49h26" stroke="var(--accent-fg)" strokeWidth="5.5" strokeLinecap="round" />
    </svg>
  )
}

/** Consistent page header: compact title, optional subtitle and trailing actions. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 pt-5 md:px-8 md:pt-8">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-fg-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
