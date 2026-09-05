'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Scatter, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import type { AuctionSeries, AuctionPoint, NationalPoint, CornPoint, CyclePoint, MarketEvent } from '@/lib/markets/series'
import { THIN_HEAD_THRESHOLD, scopeLabel } from '@/lib/market-scope'

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

// One observation as the chart sees it.
interface Dot { t: number; v: number; head: number; thin: boolean; p: AuctionPoint; series: string }

function PointTip({ active, payload, unit }: { active?: boolean; payload?: { payload: Dot }[]; unit: string }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  if (!d.p) return null
  return (
    <div className="rounded-lg border border-forest-green/15 bg-white px-3 py-2 font-dm-sans text-[15px] text-forest-green shadow-sm">
      <p className="font-semibold">{fmtWithUnit(d.v, unit)}</p>
      <p>Sale {fmtDayYear(d.p.date)} · {d.p.cls} {bandLabel(d.p.band)}</p>
      <p>{d.p.head.toLocaleString('en-US')} head reported{d.p.thin ? ` · under ${THIN_HEAD_THRESHOLD}, thin` : ''}</p>
      <p>{d.p.barn} · USDA AMS report {d.p.reportId}{d.p.revision && d.p.revision > 1 ? ` · rev ${d.p.revision}` : ''}</p>
      {d.p.low != null && d.p.high != null && <p>Range ${d.p.low}–${d.p.high}/cwt</p>}
    </div>
  )
}

// A point's visual weight is its evidence: radius and opacity scale with head.
// The VISIBLE dot is the evidence; the invisible 44 px disc behind it is the
// thumb target (Block 2D's floor), so a thin 6 px point is still tappable.
function EvidenceDot(props: { cx?: number; cy?: number; payload?: Dot; fill?: string; onPick?: (d: Dot) => void }) {
  const { cx, cy, payload, fill, onPick } = props
  if (cx == null || cy == null || !payload) return null
  const r = payload.thin ? 3 : Math.min(8, 4 + Math.log10(Math.max(1, payload.head)))
  return (
    <g onClick={() => onPick?.(payload)} style={{ cursor: 'pointer' }} data-audit="point">
      <circle cx={cx} cy={cy} r={22} fill="transparent" />
      <circle cx={cx} cy={cy} r={r} fill={fill ?? FOREST} fillOpacity={payload.thin ? 0.35 : 0.9} stroke={fill ?? FOREST} strokeOpacity={payload.thin ? 0.6 : 1} />
    </g>
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

function EventList({ events, picked, onPick }: { events: MarketEvent[]; picked: MarketEvent | null; onPick: (e: MarketEvent | null) => void }) {
  if (events.length === 0) return null
  return (
    <div className="mt-3">
      <p className="mb-2 font-dm-sans text-[15px] text-forest-green/80">Dated events on the chart (dashed lines) — tap a date for what happened and its source.</p>
      <div className="flex flex-wrap gap-2">
        {events.map(e => (
          <button key={e.id} type="button" onClick={() => onPick(picked?.id === e.id ? null : e)}
            className={`min-h-[48px] rounded-full border px-4 font-dm-sans text-[16px] font-semibold ${picked?.id === e.id ? 'border-rust bg-rust text-white' : 'border-rust/40 text-rust hover:bg-rust/5'}`}>
            ▾ {fmtDay(e.date)}
          </button>
        ))}
      </div>
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

function ObservationChart({ seriesList, unit, events, step, onPick, picked }: {
  seriesList: { name: string; color: string; dots: Dot[] }[]
  unit: string
  events: MarketEvent[]
  step: boolean
  onPick: (d: Dot) => void
  picked: boolean          // a point's panel is open — the tooltip is forced off so it never lingers over the chart
}) {
  const hoverable = useHoverable()
  const all = seriesList.flatMap(s => s.dots)
  if (all.length === 0) return <Note>No observations to draw yet.</Note>
  const ticks = [...new Set(all.map(d => d.t))].sort((a, b) => a - b)
  const x0 = ticks[0], x1 = ticks[ticks.length - 1]
  return (
    <div className="h-[320px] w-full" data-audit="chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#1B4332" strokeOpacity={0.08} vertical={false} />
          <XAxis type="number" dataKey="t" domain={[x0 - 86_400_000 * 2, x1 + 86_400_000 * 2]} ticks={ticks}
            tickFormatter={t => fmtDay(isoOf(Number(t)))} tick={{ fontSize: 15, fill: FOREST }} interval="preserveStartEnd" minTickGap={48} />
          <YAxis type="number" dataKey="v" domain={['auto', 'auto']} tick={{ fontSize: 15, fill: FOREST }} width={46} tickFormatter={v => fmtMoney(Number(v)).replace('.00', '')} />
          {hoverable && !picked && <Tooltip content={<PointTip unit={unit} />} cursor={{ stroke: FOREST, strokeOpacity: 0.15 }} />}
          <EventMarkers events={events} x0={x0 - 86_400_000 * 2} x1={x1 + 86_400_000 * 2} />
          {seriesList.map(s => (
            <Line key={`step-${s.name}`} data={s.dots} dataKey="v" type="stepAfter" stroke={s.color} strokeOpacity={step ? 0.3 : 0} strokeDasharray="3 5" dot={false} activeDot={false} isAnimationActive={false} name={`${s.name} (carried forward)`} />
          ))}
          {seriesList.map(s => (
            <Scatter key={s.name} data={s.dots} dataKey="v" fill={s.color} name={s.name} shape={<EvidenceDot fill={s.color} onPick={onPick} />} isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function MarketsCharts(p: MarketsChartsProps) {
  const [view, setView] = useState<View>('year')
  const [cls, setCls] = useState<'Steers' | 'Heifers'>('Steers')
  const [band, setBand] = useState<string>('500')
  const [measure, setMeasure] = useState<Measure>('cwt')
  const [step, setStep] = useState(true)
  const [picked, setPicked] = useState<MarketEvent | null>(null)
  const [more, setMore] = useState(false)          // band + measure live behind "More" on a phone
  const hoverable = useHoverable()
  const [pickedDot, setPickedDot] = useState<Dot | null>(null)   // a tapped point's evidence, readable below the chart

  const bandsAvailable = useMemo(() => [...new Set(p.auction.filter(s => s.cls === cls).map(s => s.band))].sort(), [p.auction, cls])
  const bandSel = bandsAvailable.includes(band) ? band : (bandsAvailable[0] ?? band)
  const unit = measureUnit(measure, bandSel, p.lot)

  const local = p.auction.find(s => s.slug === p.localSlug && s.cls === cls && s.band === bandSel) ?? null
  const others = p.auction.filter(s => s.slug !== p.localSlug && s.cls === cls && s.band === bandSel)
  const toDots = (s: AuctionSeries): Dot[] => s.points.map(pt => ({ t: ms(pt.date), v: measureValue(pt.price, measure, bandSel, p.lot), head: pt.head, thin: pt.thin, p: pt, series: s.key }))

  // Years in the spine — the honest framing for Year and Seasonality.
  const localPts = local?.points ?? []
  const years = [...new Set(localPts.map(pt => Number(pt.date.slice(0, 4))))].sort()
  const currentYear = years[years.length - 1]
  const priorYears = years.filter(y => y !== currentYear)

  const measureOptions: { value: Measure; label: string }[] = [
    { value: 'cwt', label: '$/cwt' }, { value: 'head', label: '$/head' },
    ...(p.lot ? [{ value: 'lot' as Measure, label: 'My lot' }] : []),
  ]

  return (
    // On a phone the card bleeds to the screen edges and pads 12 px, so the
    // chart takes the width; from sm it sits in the stack like every other card.
    <div className="-mx-4 sm:mx-0">
    <Card shadow="soft" className="p-3 sm:p-6" data-audit="history-card">
      <p className={EYEBROW}>Cattle markets · history</p>
      <div className="mt-3 space-y-3">
        <ChipRow<View> label="Chart" value={view} onChange={v => { setView(v); setPickedDot(null) }} options={[
          { value: 'year', label: 'This year' }, { value: 'season', label: 'Season' }, { value: 'compare', label: 'Local · national' }, { value: 'cycle', label: 'Cattle cycle' }, { value: 'corn', label: 'Corn' },
        ]} />
        {view !== 'cycle' && view !== 'corn' && (
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

      {pickedDot && pickedDot.p && (
        <div role="status" aria-live="polite" className="mt-3 rounded-lg border border-forest-green/15 bg-forest-green/[0.04] px-4 py-3 font-dm-sans text-[16px] leading-snug text-forest-green">
          <p className="font-semibold">{fmtWithUnit(pickedDot.v, unit)} · sale {fmtDayYear(pickedDot.p.date)}</p>
          <p>{pickedDot.p.cls} {bandLabel(pickedDot.p.band)} · {pickedDot.p.head.toLocaleString('en-US')} head reported{pickedDot.p.thin ? ` · under ${THIN_HEAD_THRESHOLD}, thin` : ''}</p>
          <p>{pickedDot.p.barn} · USDA AMS report {pickedDot.p.reportId}{pickedDot.p.low != null && pickedDot.p.high != null ? ` · range $${pickedDot.p.low}–${pickedDot.p.high}/cwt` : ''}</p>
          <button type="button" onClick={() => setPickedDot(null)} className="mt-1 min-h-[44px] font-semibold text-forest-green underline underline-offset-2">Close</button>
        </div>
      )}

      {view === 'year' && (
        <div className="mt-4">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green">{p.localLabel} · {cls} {bandLabel(bandSel)} · {unit}</p>
          {local ? (
            <>
              <ObservationChart
                seriesList={[
                  ...(priorYears.length ? [{ name: `${priorYears[priorYears.length - 1]}`, color: GRAY, dots: toDots({ ...local, points: local.points.filter(pt => Number(pt.date.slice(0, 4)) === priorYears[priorYears.length - 1]) }) }] : []),
                  { name: `${currentYear}`, color: FOREST, dots: toDots({ ...local, points: local.points.filter(pt => Number(pt.date.slice(0, 4)) === currentYear) }) },
                ]}
                unit={unit} events={p.events} step={step} onPick={setPickedDot} picked={!!pickedDot}
              />
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
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green">Seasonality · {cls} {bandLabel(bandSel)} · {unit}</p>
          {priorYears.length === 0 ? (
            <Note>Seasonality needs more than one year of sales. History begins {p.spineStart ? fmtDayYear(p.spineStart) : 'this year'}; this year&apos;s points are on the &ldquo;This year&rdquo; chart. Under three years it will show as a thin reference, not a rule.</Note>
          ) : (
            <Note>Averaged over {priorYears.length} prior {priorYears.length === 1 ? 'year' : 'years'}{priorYears.length < 3 ? ' — a thin reference, not a rule' : ''}.</Note>
          )}
        </div>
      )}

      {view === 'compare' && (
        <div className="mt-4">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green">Local · regional · national · {cls} {bandLabel(bandSel)} · {unit}</p>
          {(() => {
            const natMetric = cls === 'Steers' && (bandSel === '500' || bandSel === '700') ? `feeder_steer_${bandSel}` : null
            const nat = natMetric ? (p.national[natMetric] ?? []) : []
            const natDots: Dot[] = nat.map(n => ({ t: ms(n.date), v: measureValue(n.value, measure, bandSel, p.lot), head: n.head ?? 0, thin: false,
              p: { date: n.date, price: n.value, low: n.low, high: n.high, head: n.head ?? 0, thin: false, reportId: n.reportId, barn: 'USDA AMS national feeder summary', town: 'National', cls, band: bandSel, revision: null }, series: 'national' }))
            const list = [
              ...(local ? [{ name: p.localLabel, color: FOREST, dots: toDots(local) }] : []),
              ...others.map(o => ({ name: `Regional — ${o.town}`, color: UP, dots: toDots(o) })),
              ...(natDots.length ? [{ name: scopeLabel({ kind: 'national' }), color: RUST, dots: natDots }] : []),
            ]
            return (
              <>
                <ObservationChart seriesList={list} unit={unit} events={p.events} step={step} onPick={setPickedDot} picked={!!pickedDot} />
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-dm-sans text-[15px]" data-audit="legend">
                  {list.map(s => <li key={s.name} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}</li>)}
                </ul>
                <Note>
                  Three sources, three lines, never averaged together. Regional here means the other Montana barns we carry — not a Northern Plains composite, which we do not have.
                  {!natMetric && ' The national feeder summary reports 500–599 and 700–799 lb steers; no national line for this band.'}
                </Note>
              </>
            )
          })()}
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
            const feeder = local ? toDots(local) : []
            const cornDots = p.corn.map(c => ({ t: ms(c.date), v: c.settle / 100, head: 0, thin: false, p: null as unknown as AuctionPoint, series: 'corn' }))
            const all = [...feeder.map(d => d.t), ...cornDots.map(d => d.t)]
            if (all.length === 0) return <Note>No observations to draw yet.</Note>
            const x0 = Math.min(...all) - 86_400_000 * 2, x1 = Math.max(...all) + 86_400_000 * 2
            const axis = (ticks: number[]) => <XAxis type="number" dataKey="t" domain={[x0, x1]} ticks={ticks} tickFormatter={t => fmtDay(isoOf(Number(t)))} tick={{ fontSize: 15, fill: FOREST }} minTickGap={48} />
            return (
              <>
                <p className="mt-2 font-dm-sans text-[15px] text-forest-green/80">{p.localLabel} · {cls} {bandLabel(bandSel)} · $/cwt</p>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                      <CartesianGrid stroke="#1B4332" strokeOpacity={0.08} vertical={false} />
                      {axis(feeder.map(d => d.t))}
                      <YAxis dataKey="v" domain={['auto', 'auto']} tick={{ fontSize: 15, fill: FOREST }} width={46} tickFormatter={v => fmtMoney(Number(v)).replace('.00', '')} />
                      {hoverable && !pickedDot && <Tooltip content={<PointTip unit="$/cwt" />} />}
                      <EventMarkers events={p.events} x0={x0} x1={x1} />
                      <Line data={feeder} dataKey="v" type="stepAfter" stroke={FOREST} strokeOpacity={step ? 0.3 : 0} strokeDasharray="3 5" dot={false} activeDot={false} isAnimationActive={false} />
                      <Scatter data={feeder} dataKey="v" fill={FOREST} shape={<EvidenceDot fill={FOREST} onPick={setPickedDot} />} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 font-dm-sans text-[15px] text-forest-green/80">Corn · front-month settle · $/bu · CBOT via Yahoo Finance</p>
                <div className="h-[160px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                      <CartesianGrid stroke="#1B4332" strokeOpacity={0.08} vertical={false} />
                      {axis(cornDots.filter((_, i) => i % Math.max(1, Math.floor(cornDots.length / 8)) === 0).map(d => d.t))}
                      <YAxis dataKey="v" domain={['auto', 'auto']} tick={{ fontSize: 15, fill: FOREST }} width={46} tickFormatter={v => `$${Number(v).toFixed(2)}`} />
                      <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(2)}/bu`, 'Settle']} labelFormatter={t => fmtDayYear(isoOf(Number(t)))} />
                      <Line data={cornDots} dataKey="v" type="stepAfter" stroke={RUST} strokeOpacity={step ? 0.35 : 0} strokeDasharray="3 5" dot={false} activeDot={false} isAnimationActive={false} />
                      <Scatter data={cornDots} dataKey="v" fill={RUST} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <Note>Corn is the feedlot&apos;s input cost. When corn rises, the buyer&apos;s cost of gain rises and feeder bids tend to come down. That is the mechanism; no number is attached to it here, because weekly sales over a short spine cannot support one.</Note>
              </>
            )
          })()}
        </div>
      )}

      {view !== 'cycle' && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setStep(v => !v)} className="min-h-[48px] rounded-lg border border-forest-green/25 px-4 font-dm-sans text-[16px] font-semibold text-forest-green">
            {step ? 'Hide carried-forward steps' : 'Show carried-forward steps'}
          </button>
          <span className="font-dm-sans text-[15px] text-forest-green/80">Points are reported sales. Dashed steps only carry the last sale forward — nothing between sales is a price anyone reported. Small, faint points are under {THIN_HEAD_THRESHOLD} head.</span>
        </div>
      )}
      {view !== 'cycle' && <EventList events={p.events} picked={picked} onPick={setPicked} />}
      {picked && view === 'cycle' && <EventList events={p.events} picked={picked} onPick={setPicked} />}
    </Card>
    </div>
  )
}
