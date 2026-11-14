import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  hidden?: boolean
}

/** Lightweight dropdown menu with keyboard navigation, rendered in a portal. */
export function Menu({ trigger, items, align = 'end' }: { trigger: (props: { onClick: (e: React.MouseEvent) => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu'; 'aria-controls': string }) => ReactNode; items: MenuItem[]; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const visible = items.filter((i) => !i.hidden)

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const r = anchor.current.getBoundingClientRect()
    const height = visible.length * 40 + 12
    const up = r.bottom + height > window.innerHeight - 8 && r.top > height
    const width = 208
    let left = align === 'end' ? r.right - width : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    setPos({ top: up ? r.top - height - 4 : r.bottom + 4, left, up })
  }, [open, align, visible.length])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        anchor.current?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', () => setOpen(false), { once: true })
    window.addEventListener('scroll', () => setOpen(false), { once: true, capture: true })
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      buttons[(idx + 1) % buttons.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus()
    } else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <>
      <span
        ref={(el) => {
          anchor.current = el
        }}
        className="contents"
      >
        {trigger({
          onClick: (e) => {
            e.stopPropagation()
            anchor.current = (e.currentTarget as HTMLElement) ?? anchor.current
            setOpen((o) => !o)
          },
          'aria-expanded': open,
          'aria-haspopup': 'menu',
          'aria-controls': id,
        })}
      </span>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            onKeyDown={onMenuKey}
            className="fixed z-[60] w-52 rounded-lg bg-surface-2 p-1.5 shadow-pop animate-fade"
            style={{ top: pos.top, left: pos.left }}
          >
            {visible.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  item.onSelect()
                }}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] outline-none transition-colors',
                  'hover:bg-surface-3 focus-visible:bg-surface-3 disabled:opacity-40',
                  item.danger ? 'text-danger' : 'text-fg',
                )}
              >
                <span className={cn('grid size-4 place-items-center', item.danger ? 'text-danger' : 'text-fg-2')}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
