'use client'

import { useEffect, useState, type ReactNode } from 'react'

// ─── Disclosure — density by disclosure, never by shrinking (Block 7) ─────────
// Rules, from the order: the closed row shows the answer or a useful summary,
// never just a label; the whole header is tappable with a clear chevron; the
// preference is remembered where it helps; no nested disclosures; nothing
// that must stay visible (active warnings, stale-data labels, small samples,
// estimated-value labels) goes inside one. Native <details>, so scroll
// position survives open and close and no script is needed to read it.
export default function Disclosure({ title, summary, children, audit, remember, defaultOpen = false, className = '' }: {
  title: string
  summary?: ReactNode          // the closed row's answer — a number, a date, a state
  children: ReactNode
  audit?: string
  remember?: string            // localStorage key; the last open/closed state is kept per browser
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    if (!remember) return
    try { const v = localStorage.getItem(`dryline_disclosure_${remember}`); if (v === '1') setOpen(true); else if (v === '0') setOpen(false) } catch { /* private mode */ }
  }, [remember])
  const toggle = (next: boolean) => {
    setOpen(next)
    if (remember) { try { localStorage.setItem(`dryline_disclosure_${remember}`, next ? '1' : '0') } catch { /* private mode */ } }
  }
  return (
    <details open={open} onToggle={e => { const next = (e.currentTarget as HTMLDetailsElement).open; if (next !== open) toggle(next) }} className={`rounded-xl border border-forest-green/10 bg-surface ${className}`} data-audit={audit} data-open={open ? 'true' : 'false'}>
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-dm-sans hover:bg-forest-green/[0.03] [&::-webkit-details-marker]:hidden" data-audit={audit ? `${audit}-summary` : undefined}>
        <span className="min-w-0">
          <span className="block text-[17px] font-semibold text-ink">{title}</span>
          {summary != null && !open && <span className="block text-[16px] text-secondary-ink" data-audit={audit ? `${audit}-closed` : undefined}>{summary}</span>}
        </span>
        <span aria-hidden className="shrink-0 font-dm-sans text-[18px] text-forest-green">{open ? '▴' : '▾'}</span>
      </summary>
      <div className="border-t border-forest-green/10 px-4 py-3">{children}</div>
    </details>
  )
}
