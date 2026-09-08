'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// ─── The lot selector on Markets (Block 6B) ───────────────────────────────────
// Honors and writes ?lot= so a link from Ranch → Cattle lands on that lot; the
// county in view (?fips=) and any window params ride along. Changing the lot
// never touches the chart's other controls.
export default function LotSelector({ lots, selectedId }: { lots: { id: string; label: string }[]; selectedId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  if (lots.length < 2) return null
  return (
    <label className="font-dm-sans text-[14px] font-medium text-secondary-ink">
      <span className="sr-only">Lot</span>
      <select
        value={selectedId}
        onChange={e => { const next = new URLSearchParams(params.toString()); next.set('lot', e.target.value); router.replace(`${pathname}?${next.toString()}`) }}
        className="min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[16px] text-ink"
        data-audit="lot-selector"
        aria-label="Lot"
      >
        {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </label>
  )
}
