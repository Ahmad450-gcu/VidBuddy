export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--surface-2)" />
      <path d="M32 14v24" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" />
      <path d="M21 29l11 11 11-11" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 49h28" stroke="var(--text)" strokeWidth="6" strokeLinecap="round" />
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
