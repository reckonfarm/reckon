'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Scatter, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import type { AuctionSeries, AuctionPoint, NationalPoint, CornPoint, CyclePoint, MarketEvent } from '@/lib/markets/series'
import { THIN_HEAD_THRESHOLD, scopeLabel, thinEvidence } from '@/lib/market-scope'
import ReportEvidence from '@/app/components/ReportEvidence'

// ─── Markets charts (Block 2.5, Part B) ───────────────────────────────────────
// RULES, enforced here and nowhere else:
//   • Observed points render as points. Between them: nothing, or a visibly
//     distinct carried-forward STEP (dashed, faint). Never a spline, never
//     'monotone', never a straight line implying a price on a day nobody
//     reported one.
//   • X-axis ticks are the actual report dates.
//   • Tap a point → sale date, class, weight range, head reported, report id.
//   • One measure at a time ($/cwt, $/head at the band's midpoint, or the
//     value of the person's lot). No dual axes, ever.
//   • A thin point (under THIN_HEAD_THRESHOLD head) is smaller and lighter.
//   • Event markers are dated facts with a source; no effect is ever computed.

type View = 'year' | 'season' | 'compare' | 'cycle' | 'corn'
type Measure = 'cwt' | 'head' | 'lot'

export interface MarketsChartsProps {
  auction: AuctionSeries[]        // every barn × class × band series we hold
  localSlug: string | null        // the pinned or nearest barn
  localLabel: string              // "Where you sell — Billings" / "Nearby auction reference — Billings"
  national: Record<string, NationalPoint[]>   // metric → points (feeder_steer_500, feeder_steer_700, fed_steer_live)
  corn: CornPoint[]
  cycle: CyclePoint[]
  events: MarketEvent[]
  lot: { head: number; weightLb: number; label: string } | null   // the person's matching lot, for the lot-value measure
  spineStart: string | null       // earliest auction observation, ISO
}

const FOREST = '#1B4332'
const RUST = '#8B3A2B'
const UP = '#2D6A4F'
const GRAY = '#8A9A93'

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtDayYear = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10)
const bandLabel = (band: string) => `${band}–${Number(band) + 99} lb`
const midWeight = (band: string) => Number(band) + 50

function measureValue(price: number, measure: Measure, band: string, lot: MarketsChartsProps['lot']): number {
  if (measure === 'cwt') return price
  if (measure === 'head') return Math.round(price * midWeight(band) / 100)
  return lot ? Math.round(price * lot.weightLb / 100 * lot.head) : price
}
const measureUnit = (m: Measure, band: string, lot: MarketsChartsProps['lot']) =>
  m === 'cwt' ? '$/cwt' : m === 'head' ? `$/head at ${midWeight(band)} lb` : lot ? `value of ${lot.label}` : '$/cwt'
const fmtMoney = (n: number) => n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(n >= 100 ? 0 : 2)}`
// "$430/cwt", "$2,365/head at 550 lb", "$126,500 (value of Steers · 300 head)"
const fmtWithUnit = (n: number, unit: string) => unit.startsWith('$/') ? `${fmtMoney(n)}${unit.slice(1)}` : `${fmtMoney(n)} (${unit})`

// Block 2.6G — the reported spread, or the plain fact that there was one price.
const spreadLine = (pt: AuctionPoint) => {
  if (pt.low == null || pt.high == null) return ''
  const ev = thinEvidence(pt.low, pt.high, pt.price, pt.head)
  return ev.single ? (pt.thin ? ev.note : `One reported price, $${pt.price.toFixed(2)}/cwt`) : `Reported range $${pt.low}–$${pt.high}/cwt`
}

// One observation as the chart sees it.
interface Dot { t: number; v: number; head: number; thin: boolean; p: AuctionPoint; series: string; idx: number }   // idx: position in the chart's date-ordered list (Block 2.6H)

function PointTip({ active, payload, unit }: { active?: boolean; payload?: { payload: Dot }[]; unit: string }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  if (!d.p) return null
  return (
    <div className="rounded-lg border border-forest-green/15 bg-white px-3 py-2 font-dm-sans text-[15px] text-forest-green shadow-sm">
      <p className="font-semibold">{fmtWithUnit(d.v, unit)}</p>
      <p>Sale {fmtDayYear(d.p.date)} · {d.p.cls} {bandLabel(d.p.band)}</p>
      <p>{d.p.head.toLocaleString('en-US')} head reported{d.p.thin ? ` · under ${THIN_HEAD_THRESHOLD}, thin` : ''}</p>
      <p><ReportEvidence barn={d.p.barn} date={d.p.date} head={d.p.head} slug={d.p.reportId} revision={d.p.revision} /></p>
      {d.p.low != null && d.p.high != null && <p>{spreadLine(d.p)}</p>}
    </div>
  )
}

// Block 2.6H — a point's SIZE carries its sample support, with a solid outline at
// every level so contrast never depends on fill: 6 px under THIN_HEAD_THRESHOLD
// (an OPEN shape, so size is not the only cue), 9 px for 20–99 head, 12 px for
// 100+. No invisible hit disc: the thumb target is the 48 px selection strip under
// the chart, and every point is a keyboard-reachable button with a text label.
const pointRadius = (head: number) => head < THIN_HEAD_THRESHOLD ? 3 : head < 100 ? 4.5 : 6
const pointLabel = (d: Dot, unit: string) => `Sale ${fmtDayYear(d.p.date)} · ${fmtWithUnit(d.v, unit)} · ${d.p.head.toLocaleString('en-US')} head · ${d.p.barn}`
function EvidenceDot(props: { cx?: number; cy?: number; payload?: Dot; fill?: string; unit?: string; pickedKey?: string | null; onPick?: (d: Dot) => void; onKeyPick?: (d: Dot) => void; onStep?: (d: Dot, dir: -1 | 1) => void }) {
  const { cx, cy, payload, fill, unit = '$/cwt', pickedKey, onPick, onKeyPick, onStep } = props
  if (cx == null || cy == null || !payload?.p) return null
  const r = pointRadius(payload.head)
  const color = fill ?? FOREST
  const selected = pickedKey === dotKey(payload)
  return (
    <g role="button" tabIndex={0} aria-label={pointLabel(payload, unit)} aria-pressed={selected} data-audit="point" data-idx={payload.idx}
      onClick={() => onPick?.(payload)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (onKeyPick ?? onPick)?.(payload) }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onStep?.(payload, 1) }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onStep?.(payload, -1) }
      }}
      style={{ cursor: 'pointer', outline: 'none' }}>
      {selected && <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={RUST} strokeWidth={2} />}
      <circle cx={cx} cy={cy} r={r} fill={payload.thin ? '#FFFFFF' : color} stroke={color} strokeWidth={2} />
    </g>
  )
}
const dotKey = (d: Dot) => `${d.series}@${d.t}`

// Block 2.6H — the 48 px selection strip: the chart's time axis, laid under the
// plot, where a thumb picks the NEAREST sale by date. Overlapping targets are the
// failure mode of a weekly series; a strip has none. Keyboard: arrows step through
// the sales in date order, Home/End jump; the pick is announced by the panel.
function SelectionStrip({ ordered, x0, x1, pickedKey, unit, onPick }: { ordered: Dot[]; x0: number; x1: number; pickedKey: string | null; unit: string; onPick: (d: Dot) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  if (ordered.length === 0) return null
  const idx = pickedKey ? ordered.findIndex(d => dotKey(d) === pickedKey) : -1
  const picked = idx >= 0 ? ordered[idx] : null
  const pickAt = (clientX: number) => {
    const el = ref.current
    if (!el) return
    const b = el.getBoundingClientRect()
    const t = x0 + ((clientX - b.left) / Math.max(1, b.width)) * (x1 - x0)
    let best = ordered[0]
    for (const d of ordered) if (Math.abs(d.t - t) < Math.abs(best.t - t)) best = d
    onPick(best)
  }
  const stepTo = (i: number) => onPick(ordered[Math.max(0, Math.min(ordered.length - 1, i))])
  return (
    <div ref={ref} role="slider" tabIndex={0} aria-label="Pick a sale by date" aria-valuemin={0} aria-valuemax={ordered.length - 1}
      aria-valuenow={idx >= 0 ? idx : 0} aria-valuetext={picked ? pointLabel(picked, unit) : 'No sale picked'} data-audit="selection-strip"
      className="relative mt-1 h-12 min-h-[48px] cursor-pointer touch-none select-none rounded-md border border-forest-green/15 bg-forest-green/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-green"
      style={{ marginLeft: 46, marginRight: 8 }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pickAt(e.clientX) }}
      onPointerMove={e => { if (e.buttons > 0) pickAt(e.clientX) }}
      onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); stepTo(idx < 0 ? 0 : idx + 1) }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); stepTo(idx < 0 ? ordered.length - 1 : idx - 1) }
        else if (e.key === 'Home') { e.preventDefault(); stepTo(0) }
        else if (e.key === 'End') { e.preventDefault(); stepTo(ordered.length - 1) }
      }}>
      {ordered.map(d => {
        const left = x1 > x0 ? ((d.t - x0) / (x1 - x0)) * 100 : 50
        const on = pickedKey === dotKey(d)
        return <span key={dotKey(d)} aria-hidden className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm ${on ? 'h-9 w-[4px] bg-rust' : 'h-6 w-[3px] bg-forest-green/50'}`} style={{ left: `${left}%` }} />
      })}
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-1.5 font-dm-sans text-[15px] leading-none text-forest-green/60">Slide or tap to pick a sale</span>
    </div>
  )
}

function EventMarkers({ events, x0, x1 }: { events: MarketEvent[]; x0: number; x1: number }) {
  return (
    <>
      {events.filter(e => ms(e.date) >= x0 && ms(e.date) <= x1).map(e => (
        <ReferenceLine key={e.id} x={ms(e.date)} stroke={RUST} strokeDasharray="2 4" strokeOpacity={0.7} />
      ))}
    </>
  )
}

// Block 2.6F — every closed chip carries its year, chips run in date order, and
// only events inside the chart's own dates show by default; the rest sit behind
// one disclosure so six chips can never read as one summer.
type Period = { x0: number; x1: number } | null
function EventChip({ e, on, onPick }: { e: MarketEvent; on: boolean; onPick: (e: MarketEvent | null) => void }) {
  return (
    <button type="button" onClick={() => onPick(on ? null : e)} aria-pressed={on} data-audit="event-chip"
      className={`min-h-[48px] rounded-full border px-4 font-dm-sans text-[16px] font-semibold ${on ? 'border-rust bg-rust text-white' : 'border-rust/40 text-rust hover:bg-rust/5'}`}>
      ▾ {fmtDayYear(e.date)}
    </button>
  )
}
function EventList({ events, picked, onPick, period }: { events: MarketEvent[]; picked: MarketEvent | null; onPick: (e: MarketEvent | null) => void; period: Period }) {
  const [showOutside, setShowOutside] = useState(false)
  if (events.length === 0) return null
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const inside = period ? sorted.filter(e => ms(e.date) >= period.x0 && ms(e.date) <= period.x1) : sorted
  const outside = period ? sorted.filter(e => ms(e.date) < period.x0 || ms(e.date) > period.x1) : []
  const earlier = outside.filter(e => period && ms(e.date) < period.x0).length
  return (
    <div className="mt-3">
      <p className="mb-2 font-dm-sans text-[15px] text-forest-green/80">
        {inside.length > 0
          ? <>Dated events on the chart (dashed lines) — tap a date for what happened and its source.</>
          : <>No dated events fall inside this chart&apos;s dates.</>}
      </p>
      <div className="flex flex-wrap gap-2">
        {inside.map(e => <EventChip key={e.id} e={e} on={picked?.id === e.id} onPick={onPick} />)}
        {outside.length > 0 && (
          <button type="button" aria-expanded={showOutside} onClick={() => setShowOutside(v => !v)} data-audit="event-more"
            className="min-h-[48px] rounded-full border border-forest-green/25 px-4 font-dm-sans text-[16px] font-semibold text-forest-green hover:bg-forest-green/5">
            {outside.length} {earlier === outside.length ? 'earlier' : 'other'} event{outside.length === 1 ? '' : 's'} {showOutside ? '▴' : '▾'}
          </button>
        )}
      </div>
      {showOutside && outside.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" data-audit="event-outside">
          {outside.map(e => <EventChip key={e.id} e={e} on={picked?.id === e.id} onPick={onPick} />)}
        </div>
      )}
      {picked && (
        <div className="mt-2 rounded-lg border border-rust/20 bg-rust/[0.04] px-4 py-3 font-dm-sans text-[16px] leading-snug text-forest-green">
          <p className="font-semibold">{fmtDayYear(picked.date)} · {picked.title}</p>
          <p className="mt-1">{picked.description}</p>
          <a href={picked.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block min-h-[44px] font-semibold text-forest-green underline underline-offset-2">Source: {picked.sourceName} →</a>
        </div>
      )}
    </div>
  )
}

const Note = ({ children }: { children: React.ReactNode }) => <p className="mt-2 font-dm-sans text-[15px] leading-snug text-forest-green/80">{children}</p>

// Block 2.6B — the vertical axis names its unit in words, from the SAME `unit`
// the title and the tooltip read, so a stale measure can never leave the axis
// in one unit and the title in another. The smoke asserts the two agree.
const AxisUnit = ({ unit }: { unit: string }) => (
  <p className="mt-1 font-dm-sans text-[15px] text-forest-green/70" data-audit="axis-unit">Vertical axis · {unit}</p>
)

// A wrapping row of 48 px chips — never a horizontal scroll, never a shrunk
// segmented control. One row per selector; the active chip is solid.
function ChipRow<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(o => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`min-h-[48px] rounded-lg px-4 font-dm-sans text-[16px] font-semibold ${on ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green hover:bg-forest-green/5'}`}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── The time-axis observation chart used by Compare and (single-series) Year ──
// On a touch device the hover tooltip would linger over the chart after a
// tap and duplicate the evidence panel — so it only exists where hover does.
function useHoverable(): boolean {
  const [hover, setHover] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover)')
    const apply = () => setHover(mq.matches)
    apply(); mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return hover
}

function ObservationChart({ seriesList, ordered, unit, events, step, onPick, pickedKey, height = 320, domain }: {
  seriesList: { name: string; color: string; dots: Dot[] }[]
  ordered: Dot[]           // every point of the chart in date order (Block 2.6H)
  unit: string
  events: MarketEvent[]
  step: boolean
  onPick: (d: Dot) => void
  pickedKey: string | null // the picked point's key — the tooltip is forced off while a panel is open so it never lingers over the chart
  height?: number
  domain?: [number, number] // a shared time domain (the Corn view lays two charts on one axis)
}) {
  const hoverable = useHoverable()
  // Keyboard on a point: the pick re-renders the chart and the focused <g> can be
  // replaced under the caret. The wanted index is noted in the handler and focus is
  // put back in the commit that follows — before any further keystroke is processed.
  const wantFocus = useRef<number | null>(null)
  useEffect(() => {
    if (wantFocus.current == null) return
    const el = document.querySelector(`[data-audit="chart"] [data-audit="point"][data-idx="${wantFocus.current}"]`) as HTMLElement | null
    wantFocus.current = null
    el?.focus()
  })
  const all = seriesList.flatMap(s => s.dots)
  if (all.length === 0) return <Note>No observations to draw yet.</Note>
  const ticks = [...new Set(all.map(d => d.t))].sort((a, b) => a - b)
  const x0 = domain ? domain[0] : ticks[0] - 86_400_000 * 2, x1 = domain ? domain[1] : ticks[ticks.length - 1] + 86_400_000 * 2
  const focusPoint = (idx: number) => { wantFocus.current = idx }
  const onKeyPick = (d: Dot) => { onPick(d); focusPoint(d.idx) }
  const onStep = (d: Dot, dir: -1 | 1) => {
    const i = ordered.findIndex(x => dotKey(x) === dotKey(d))
    const n = ordered[(i < 0 ? d.idx : i) + dir]
    if (!n) return
    onPick(n)
    focusPoint(n.idx)
  }
  return (
    <div className="w-full" data-audit="chart">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#1B4332" strokeOpacity={0.08} vertical={false} />
          <XAxis type="number" dataKey="t" domain={[x0, x1]} ticks={ticks}
            tickFormatter={t => fmtDay(isoOf(Number(t)))} tick={{ fontSize: 15, fill: FOREST }} interval="preserveStartEnd" minTickGap={48} />
          <YAxis type="number" dataKey="v" domain={['auto', 'auto']} tick={{ fontSize: 15, fill: FOREST }} width={46} tickFormatter={v => fmtMoney(Number(v)).replace('.00', '')} />
          {hoverable && !pickedKey && <Tooltip content={<PointTip unit={unit} />} cursor={{ stroke: FOREST, strokeOpacity: 0.15 }} />}
          <EventMarkers events={events} x0={x0} x1={x1} />
          {seriesList.map(s => (
            <Line key={`step-${s.name}`} data={s.dots} dataKey="v" type="stepAfter" stroke={s.color} strokeOpacity={step ? 0.3 : 0} strokeDasharray="3 5" dot={false} activeDot={false} isAnimationActive={false} name={`${s.name} (carried forward)`} />
          ))}
          {seriesList.map(s => (
            <Scatter key={s.name} data={s.dots} dataKey="v" fill={s.color} name={s.name} shape={<EvidenceDot fill={s.color} unit={unit} pickedKey={pickedKey} onPick={onPick} onKeyPick={onKeyPick} onStep={onStep} />} isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <SelectionStrip ordered={ordered} x0={x0} x1={x1} pickedKey={pickedKey} unit={unit} onPick={onPick} />
      <AxisUnit unit={unit} />
    </div>
  )
}

// Block 2.6H — "View sales as list": every point of the current chart as a
// chronological list of 48 px rows, each a focusable button that picks the sale.
function SalesList({ ordered, unit, pickedKey, onPick }: { ordered: Dot[]; unit: string; pickedKey: string | null; onPick: (d: Dot) => void }) {
  if (ordered.length === 0) return <Note>No sales to list.</Note>
  return (
    <ol className="mt-2 divide-y divide-forest-green/[0.08] border-y border-forest-green/[0.08]" data-audit="sales-list" aria-label="Sales in date order">
      {ordered.map(d => {
        const on = pickedKey === dotKey(d)
        return (
          <li key={dotKey(d)}>
            <button type="button" aria-pressed={on} onClick={() => onPick(d)}
              className={`flex min-h-[48px] w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-2 text-left font-dm-sans text-[16px] tabular-nums ${on ? 'bg-forest-green/[0.06] text-forest-green' : 'text-forest-green hover:bg-forest-green/[0.03]'}`}>
              <span className="font-semibold">{fmtDayYear(d.p.date)}</span>
              <span>{fmtWithUnit(d.v, unit)}</span>
              <span className="text-forest-green/80">{d.p.head.toLocaleString('en-US')} head{d.p.thin ? ' · thin' : ''}</span>
              <span className="text-forest-green/80">{d.p.town === 'National' ? d.p.barn : d.p.town.replace(/,\s*[A-Z]{2}$/, '')}</span>
            </button>
            <span className="block px-2 pb-1 font-dm-sans text-[15px] text-forest-green/80"><ReportEvidence barn={d.p.barn} date={d.p.date} head={d.p.head} slug={d.p.reportId} /></span>
          </li>
        )
      })}
    </ol>
  )
}

export default function MarketsCharts(p: MarketsChartsProps) {
  const [view, setView] = useState<View>('year')
  const [cls, setCls] = useState<'Steers' | 'Heifers'>('Steers')
  const [band, setBand] = useState<string>('500')
  const [measure, setMeasure] = useState<Measure>('cwt')
  const [step, setStep] = useState(false)   // Block 2.6E — observed points only by default; never imply a price between sales
  const [picked, setPicked] = useState<MarketEvent | null>(null)
  const [more, setMore] = useState(false)          // band + measure live behind "More" on a phone
  const [listOpen, setListOpen] = useState(false)  // Block 2.6H — "View sales as list"
  // The picked point is remembered by (series, date) so it survives a measure
  // change: the panel always re-reads the live dot in the current unit.
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const pick = (d: Dot) => setPickedKey(dotKey(d))

  const bandsAvailable = useMemo(() => [...new Set(p.auction.filter(s => s.cls === cls).map(s => s.band))].sort(), [p.auction, cls])
  const bandSel = bandsAvailable.includes(band) ? band : (bandsAvailable[0] ?? band)
  const unit = measureUnit(measure, bandSel, p.lot)

  const local = p.auction.find(s => s.slug === p.localSlug && s.cls === cls && s.band === bandSel) ?? null
  const others = p.auction.filter(s => s.slug !== p.localSlug && s.cls === cls && s.band === bandSel)
  const toDots = (s: AuctionSeries): Dot[] => s.points.map(pt => ({ t: ms(pt.date), v: measureValue(pt.price, measure, bandSel, p.lot), head: pt.head, thin: pt.thin, p: pt, series: s.key, idx: 0 }))

  // Years in the spine — the honest framing for Year and Seasonality.
  const localPts = local?.points ?? []
  const years = [...new Set(localPts.map(pt => Number(pt.date.slice(0, 4))))].sort()
  const currentYear = years[years.length - 1]
  const priorYears = years.filter(y => y !== currentYear)

  // ── The series each view draws (Block 2.6H: built once, so the chart, the
  //    selection strip, Previous/Next, and the list all walk the same points). ──
  const yearList = local ? [
    ...(priorYears.length ? [{ name: `${priorYears[priorYears.length - 1]}`, color: GRAY, dots: toDots({ ...local, points: local.points.filter(pt => Number(pt.date.slice(0, 4)) === priorYears[priorYears.length - 1]) }) }] : []),
    { name: `${currentYear}`, color: FOREST, dots: toDots({ ...local, points: local.points.filter(pt => Number(pt.date.slice(0, 4)) === currentYear) }) },
  ] : []
  const natMetric = cls === 'Steers' && (bandSel === '500' || bandSel === '700') ? `feeder_steer_${bandSel}` : null
  const nat = natMetric ? (p.national[natMetric] ?? []) : []
  const natDots: Dot[] = nat.map(n => ({ t: ms(n.date), v: measureValue(n.value, measure, bandSel, p.lot), head: n.head ?? 0, thin: false,
    p: { date: n.date, price: n.value, low: n.low, high: n.high, head: n.head ?? 0, thin: false, reportId: n.reportId, barn: 'USDA AMS national feeder summary', town: 'National', cls, band: bandSel, revision: null }, series: 'national', idx: 0 }))
  const compareList = [
    ...(local ? [{ name: p.localLabel, color: FOREST, dots: toDots(local) }] : []),
    ...others.map(o => ({ name: `Regional — ${o.town}`, color: UP, dots: toDots(o) })),
    ...(natDots.length ? [{ name: scopeLabel({ kind: 'national' }), color: RUST, dots: natDots }] : []),
  ]
  const cornFeederList = local ? [{ name: p.localLabel, color: FOREST, dots: toDots(local) }] : []
  const activeList = view === 'year' ? yearList : view === 'compare' ? compareList : view === 'corn' ? cornFeederList : []
  const ordered = activeList.flatMap(s => s.dots).sort((a, b) => a.t - b.t || a.series.localeCompare(b.series))
  ordered.forEach((d, i) => { d.idx = i })
  const pickedIdx = pickedKey ? ordered.findIndex(d => dotKey(d) === pickedKey) : -1
  const pickedDot = pickedIdx >= 0 ? ordered[pickedIdx] : null
  const livePickedKey = pickedDot ? pickedKey : null

  // Block 2.6F — the chart's own dates, per view: the span of the points it draws.
  const period: Period = (() => {
    const pad = 86_400_000 * 2
    const yearsShown = priorYears.length ? [priorYears[priorYears.length - 1], currentYear] : [currentYear]
    const dates: string[] =
      view === 'year' ? localPts.filter(pt => yearsShown.includes(Number(pt.date.slice(0, 4)))).map(pt => pt.date)
      : view === 'compare' ? [...localPts.map(pt => pt.date), ...others.flatMap(o => o.points.map(pt => pt.date)), ...Object.values(p.national).flat().map(n => n.date)]
      : view === 'cycle' ? p.cycle.map(c => c.date)
      : view === 'corn' ? [...localPts.map(pt => pt.date), ...p.corn.map(c => c.date)]
      : localPts.map(pt => pt.date)
    if (dates.length === 0) return null
    const ts = dates.map(ms)
    return { x0: Math.min(...ts) - pad, x1: Math.max(...ts) + pad }
  })()

  const measureOptions: { value: Measure; label: string }[] = [
    { value: 'cwt', label: '$/cwt' }, { value: 'head', label: '$/head' },
    ...(p.lot ? [{ value: 'lot' as Measure, label: 'My lot' }] : []),
  ]

  const chartProps = { ordered, unit, events: p.events, step, onPick: pick, pickedKey: livePickedKey }

  return (
    // On a phone the card bleeds to the screen edges and pads 12 px, so the
    // chart takes the width; from sm it sits in the stack like every other card.
    <div className="-mx-4 sm:mx-0">
    <Card shadow="soft" className="p-3 sm:p-6" data-audit="history-card">
      <p className={EYEBROW}>Cattle markets · history</p>
      <div className="mt-3 space-y-3">
        <ChipRow<View> label="Chart" value={view} onChange={v => { setView(v); setPickedKey(null) }} options={[
          { value: 'year', label: 'This year' }, { value: 'season', label: 'Season' }, { value: 'compare', label: 'Local · national' }, { value: 'cycle', label: 'Cattle cycle' }, { value: 'corn', label: 'Corn' },
        ]} />
        {view !== 'cycle' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ChipRow<'Steers' | 'Heifers'> label="Class" value={cls} onChange={setCls} options={[{ value: 'Steers', label: 'Steers' }, { value: 'Heifers', label: 'Heifers' }]} />
              <button type="button" aria-expanded={more} onClick={() => setMore(v => !v)}
                className="min-h-[48px] rounded-lg border border-forest-green/25 px-4 font-dm-sans text-[16px] font-semibold text-forest-green hover:bg-forest-green/5">
                {more ? 'Less ▴' : `${bandLabel(bandSel)} · ${measure === 'cwt' ? '$/cwt' : measure === 'head' ? '$/head' : 'My lot'} · More ▾`}
              </button>
            </div>
            {more && (
              <div className="space-y-3 rounded-lg border border-forest-green/10 bg-cream/60 p-3">
                {bandsAvailable.length > 0 && (
                  <div>
                    <p className="mb-2 font-dm-sans text-[15px] font-semibold text-forest-green">Weight band</p>
                    <ChipRow<string> label="Weight band" value={bandSel} onChange={setBand} options={bandsAvailable.map(b => ({ value: b, label: bandLabel(b) }))} />
                  </div>
                )}
                <div>
                  <p className="mb-2 font-dm-sans text-[15px] font-semibold text-forest-green">Measure</p>
                  <ChipRow<Measure> label="Measure" value={measure} onChange={setMeasure} options={measureOptions} />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* The picked sale — the detail sheet. Announced (aria-live), with 48 px
          Previous / Next that walk the chart's sales in date order (Block 2.6H). */}
      {pickedDot && (
        <div role="status" aria-live="polite" className="mt-3 rounded-lg border border-forest-green/15 bg-forest-green/[0.04] px-4 py-3 font-dm-sans text-[16px] leading-snug text-forest-green" data-audit="point-sheet">
          <p className="font-semibold">{fmtWithUnit(pickedDot.v, unit)} · sale {fmtDayYear(pickedDot.p.date)}</p>
          <p>{pickedDot.p.cls} {bandLabel(pickedDot.p.band)} · {pickedDot.p.head.toLocaleString('en-US')} head reported{pickedDot.p.thin ? ` · under ${THIN_HEAD_THRESHOLD}, thin` : ''}</p>
          <p><ReportEvidence barn={pickedDot.p.barn} date={pickedDot.p.date} head={pickedDot.p.head} slug={pickedDot.p.reportId} revision={pickedDot.p.revision} />{spreadLine(pickedDot.p) ? ` · ${spreadLine(pickedDot.p)}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={pickedIdx <= 0} onClick={() => { const n = ordered[pickedIdx - 1]; if (n) pick(n) }} data-audit="point-prev"
              className="min-h-[48px] rounded-lg border border-forest-green/25 px-4 font-semibold text-forest-green disabled:opacity-40">‹ Previous sale</button>
            <button type="button" disabled={pickedIdx >= ordered.length - 1} onClick={() => { const n = ordered[pickedIdx + 1]; if (n) pick(n) }} data-audit="point-next"
              className="min-h-[48px] rounded-lg border border-forest-green/25 px-4 font-semibold text-forest-green disabled:opacity-40">Next sale ›</button>
            <button type="button" onClick={() => setPickedKey(null)} className="min-h-[48px] px-2 font-semibold text-forest-green underline underline-offset-2">Close</button>
          </div>
        </div>
      )}

      {view === 'year' && (
        <div className="mt-4">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="chart-title">{p.localLabel} · {cls} {bandLabel(bandSel)} · {unit}</p>
          {local ? (
            <>
              <ObservationChart seriesList={yearList} {...chartProps} />
              <Note>
                {priorYears.length === 0
                  ? <>History begins {p.spineStart ? fmtDayYear(p.spineStart) : 'this year'} — no prior year to compare yet, and no five-year band. The band appears as years accrue and will say how many it holds.</>
                  : <>Prior year in gray. Band from {priorYears.length} prior {priorYears.length === 1 ? 'year' : 'years'} — not five until five exist.</>}
              </Note>
            </>
          ) : <Note>No {cls.toLowerCase()} {bandLabel(bandSel)} observations at this barn yet.</Note>}
        </div>
      )}

      {view === 'season' && (
        <div className="mt-4">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="chart-title">Seasonality · {cls} {bandLabel(bandSel)} · {unit}</p>
          {priorYears.length === 0 ? (
            <Note>Seasonality needs more than one year of sales. History begins {p.spineStart ? fmtDayYear(p.spineStart) : 'this year'}; this year&apos;s points are on the &ldquo;This year&rdquo; chart. Under three years it will show as a thin reference, not a rule.</Note>
          ) : (
            <Note>Averaged over {priorYears.length} prior {priorYears.length === 1 ? 'year' : 'years'}{priorYears.length < 3 ? ' — a thin reference, not a rule' : ''}.</Note>
          )}
        </div>
      )}

      {view === 'compare' && (
        <div className="mt-4">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="chart-title">Local · regional · national · {cls} {bandLabel(bandSel)} · {unit}</p>
          <ObservationChart seriesList={compareList} {...chartProps} />
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-dm-sans text-[15px]" data-audit="legend">
            {compareList.map(s => <li key={s.name} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}</li>)}
          </ul>
          <Note>
            Three sources, three lines, never averaged together. Regional here means the other Montana barns we carry — not a Northern Plains composite, which we do not have.
            {!natMetric && ' The national feeder summary reports 500–599 and 700–799 lb steers; no national line for this band.'}
          </Note>
        </div>
      )}

      {view === 'cycle' && (
        <div className="mt-4">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green">Cattle cycle · U.S. heifers and heifer calves on feed · USDA NASS</p>
          {p.cycle.length === 0 ? <Note>No inventory points stored yet.</Note> : (
            <>
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={p.cycle.map(c => ({ t: ms(c.date), v: c.heifersOnFeed, c }))} margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="#1B4332" strokeOpacity={0.08} vertical={false} />
                    <XAxis type="number" dataKey="t" domain={['dataMin', 'dataMax']} ticks={p.cycle.map(c => ms(c.date))} tickFormatter={t => fmtDay(isoOf(Number(t)))} tick={{ fontSize: 15, fill: FOREST }} />
                    <YAxis dataKey="v" tick={{ fontSize: 15, fill: FOREST }} width={58} tickFormatter={v => `${(Number(v) / 1e6).toFixed(2)}M`} domain={['auto', 'auto']} />
                    <Tooltip formatter={(v: unknown) => [`${Number(v).toLocaleString('en-US')} head`, 'On feed']} labelFormatter={t => fmtDayYear(isoOf(Number(t)))} />
                    <Scatter dataKey="v" fill={FOREST} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {(() => {
                const last = p.cycle[p.cycle.length - 1]
                const dir = last.yoyPct == null ? 'no prior-year quarter on file' : last.yoyPct < -0.1 ? `${Math.abs(last.yoyPct).toFixed(1)}% fewer heifers on feed than a year ago — heifers are being kept back, which is what herd rebuilding looks like in the reported numbers` : last.yoyPct > 0.1 ? `${last.yoyPct.toFixed(1)}% more heifers on feed than a year ago — heifers are going to feed rather than being kept, which is what contraction looks like in the reported numbers` : 'about even with a year ago'
                return <Note>{p.cycle.length} quarterly {p.cycle.length === 1 ? 'point' : 'points'} stored ({fmtDayYear(p.cycle[0].date)} → {fmtDayYear(last.date)}). Latest: {dir}. Descriptive only — the reported inventory, not a forecast. A long-run herd inventory line needs the NASS January 1 cattle inventory series, which is not stored yet.</Note>
              })()}
            </>
          )}
        </div>
      )}

      {view === 'corn' && (
        <div className="mt-4">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green">Corn and feeder cattle · two charts, one time axis</p>
          {(() => {
            const feeder = cornFeederList.flatMap(s => s.dots)
            const cornDots = p.corn.map(c => ({ t: ms(c.date), v: c.settle / 100 }))
            const all = [...feeder.map(d => d.t), ...cornDots.map(d => d.t)]
            if (all.length === 0) return <Note>No observations to draw yet.</Note>
            const x0 = Math.min(...all) - 86_400_000 * 2, x1 = Math.max(...all) + 86_400_000 * 2
            return (
              <>
                <p className="mt-2 font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="chart-title">{p.localLabel} · {cls} {bandLabel(bandSel)} · {unit}</p>
                {feeder.length > 0
                  ? <ObservationChart seriesList={cornFeederList} {...chartProps} height={200} domain={[x0, x1]} />
                  : <Note>No {cls.toLowerCase()} {bandLabel(bandSel)} observations at this barn yet.</Note>}
                <p className="mt-2 font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="chart-title">Corn · front-month settle · CBOT via Yahoo Finance · $/bu</p>
                <div className="h-[160px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                      <CartesianGrid stroke="#1B4332" strokeOpacity={0.08} vertical={false} />
                      <XAxis type="number" dataKey="t" domain={[x0, x1]} ticks={cornDots.filter((_, i) => i % Math.max(1, Math.floor(cornDots.length / 8)) === 0).map(d => d.t)} tickFormatter={t => fmtDay(isoOf(Number(t)))} tick={{ fontSize: 15, fill: FOREST }} minTickGap={48} />
                      <YAxis dataKey="v" domain={['auto', 'auto']} tick={{ fontSize: 15, fill: FOREST }} width={46} tickFormatter={v => `$${Number(v).toFixed(2)}`} />
                      <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(2)}/bu`, 'Settle']} labelFormatter={t => fmtDayYear(isoOf(Number(t)))} />
                      <Line data={cornDots} dataKey="v" type="stepAfter" stroke={RUST} strokeOpacity={step ? 0.35 : 0} strokeDasharray="3 5" dot={false} activeDot={false} isAnimationActive={false} />
                      <Scatter data={cornDots} dataKey="v" fill={RUST} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <AxisUnit unit="$/bu" />
                <Note>Corn is the feedlot&apos;s input cost. When corn rises, the buyer&apos;s cost of gain rises and feeder bids tend to come down. That is the mechanism; no number is attached to it here, because weekly sales over a short spine cannot support one.</Note>
              </>
            )
          })()}
        </div>
      )}

      {view !== 'cycle' && view !== 'season' && ordered.length > 0 && (
        <div className="mt-3">
          <button type="button" aria-expanded={listOpen} onClick={() => setListOpen(v => !v)} data-audit="sales-list-toggle"
            className="min-h-[48px] rounded-lg border border-forest-green/25 px-4 font-dm-sans text-[16px] font-semibold text-forest-green hover:bg-forest-green/5">
            {listOpen ? 'Hide the list ▴' : `View sales as list (${ordered.length}) ▾`}
          </button>
          {listOpen && <SalesList ordered={ordered} unit={unit} pickedKey={livePickedKey} onPick={pick} />}
        </div>
      )}

      {view !== 'cycle' && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setStep(v => !v)} className="min-h-[48px] rounded-lg border border-forest-green/25 px-4 font-dm-sans text-[16px] font-semibold text-forest-green">
            {step ? 'Hide carried-forward steps' : 'Show carried-forward steps'}
          </button>
          <span className="font-dm-sans text-[15px] text-forest-green/80" data-audit="step-copy">
            {step
              ? <>Points are reported sales. Dashed steps only carry the last sale forward — nothing between sales is a price anyone reported.</>
              : <>Points are reported sales. Nothing is drawn between them — no price between sales was reported.</>}
            {' '}Point size is head count: open points are under {THIN_HEAD_THRESHOLD} head, small solid points 20–99, large solid points 100 or more.
          </span>
        </div>
      )}
      {view !== 'cycle' && <EventList events={p.events} picked={picked} onPick={setPicked} period={period} />}
      {picked && view === 'cycle' && <EventList events={p.events} picked={picked} onPick={setPicked} period={period} />}
    </Card>
    </div>
  )
}
