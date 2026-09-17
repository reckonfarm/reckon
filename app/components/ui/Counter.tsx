'use client'

// ─── −/+ at 56 px (Block 15, ruling 6) ────────────────────────────────────────
// Any small number is set by thumb: head, bales, bred, open. The number stays
// an input, so a big one can still be typed.
export default function Counter({ label, value, onChange, unit, audit, min = 0, max = 20000 }: { label: string; value: string; onChange: (v: string) => void; unit?: string; audit: string; min?: number; max?: number }) {
  const n = value.trim() === '' ? 0 : Math.max(min, Math.floor(Number(value) || 0))
  const set = (k: number) => onChange(String(Math.max(min, Math.min(max, k))))
  const btn = 'inline-flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-xl border border-control-border bg-surface font-dm-sans text-[26px] leading-none text-ink active:bg-forest-green/10 disabled:opacity-40'
  return (
    <div data-audit={audit}>
      <p id={`${audit}-label`} className="font-dm-sans text-[16px] font-medium text-ink">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        {/* The buttons' names carry no field name: a label lookup for "Head" must find the input, not three controls. */}
        <button type="button" onClick={() => set(n - 1)} disabled={n <= min} className={btn} aria-label="Minus one" aria-describedby={`${audit}-label`} data-audit={`${audit}-minus`}>−</button>
        <input type="number" inputMode="numeric" min={min} max={max} value={value} placeholder="0" onChange={e => onChange(e.target.value)}
          className="min-h-[56px] w-full rounded-xl border border-control-border bg-surface px-3 text-center font-dm-sans text-[24px] tabular-nums text-ink" aria-label={label} data-audit={`${audit}-input`} />
        <button type="button" onClick={() => set(n + 1)} className={btn} aria-label="Plus one" aria-describedby={`${audit}-label`} data-audit={`${audit}-plus`}>+</button>
        {unit && <span className="shrink-0 font-dm-sans text-[16px] text-secondary-ink">{unit}</span>}
      </div>
    </div>
  )
}
