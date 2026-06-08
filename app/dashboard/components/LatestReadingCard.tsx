import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'

// Weekly USDM history point (relocated from the old DroughtHistoryChart). d0..d4 are
// CUMULATIVE coverage ("Dn or worse"); `none` is unused here but kept for shape parity
// with the USDM API mapping in page.tsx.
export interface DroughtHistoryWeek {
  date: string
  none: number
  d0: number
  d1: number
  d2: number
  d3: number
  d4: number
}

interface Reading {
  week_date: string
  d0: number | null
  d1: number | null
  d2: number | null
  d3: number | null
  d4: number | null
}

// Official USDM hex (matches the map legend + the rest of the dashboard). None = a light
// neutral so "no drought" reads as empty, not as a category.
const USDM_HEX: Record<number, string> = {
  0: '#FFFF00', 1: '#FCD37F', 2: '#FFAA00', 3: '#E60000', 4: '#730000',
}
const NONE_HEX = '#EAE7E0'
const CAT_NAME: Record<number, string> = {
  0: 'Abnormally dry', 1: 'Moderate drought', 2: 'Severe drought', 3: 'Extreme drought', 4: 'Exceptional drought',
}

// Highest drought category from cumulative d0..d4 — the SAME rule as the Latest Reading
// icon: the most severe per-category bucket (cumulative differences) clearing 0.5%.
function categoryOf(d0: number, d1: number, d2: number, d3: number, d4: number): number | null {
  const buckets = [d0 - d1, d1 - d2, d2 - d3, d3 - d4, d4]
  for (let n = 4; n >= 0; n--) if (buckets[n] > 0.5) return n
  return null
}

function formatWeek(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function seasonOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const m = d.getMonth() // 0=Jan
  const y = d.getFullYear()
  if (m === 11) return `winter ${y + 1}`        // Dec → meteorological winter of next year
  if (m <= 1) return `winter ${y}`              // Jan, Feb
  if (m <= 4) return `spring ${y}`              // Mar–May
  if (m <= 7) return `summer ${y}`              // Jun–Aug
  return `fall ${y}`                            // Sep–Nov
}

// ── Hero: current category + one honest coverage number, from the reliable DB reading ──
function Hero({ latest }: { latest: Reading }) {
  const d0 = latest.d0 ?? 0, d1 = latest.d1 ?? 0
  const cat = categoryOf(d0, d1, latest.d2 ?? 0, latest.d3 ?? 0, latest.d4 ?? 0)

  // 3-way honest coverage: in-drought (D1+) → abnormally-dry (D0) → none.
  const coverage =
    d1 >= 0.5 ? `${Math.round(d1)}% of county in drought`
      : d1 > 0 ? '<1% of county in drought'
        : d0 >= 0.5 ? `${Math.round(d0)}% abnormally dry`
          : 'Not in drought'

  return (
    <div className="flex items-center gap-3">
      {cat !== null ? (
        <span
          className="inline-flex h-9 w-11 flex-shrink-0 items-center justify-center rounded-md text-sm font-bold font-dm-sans"
          style={{ backgroundColor: USDM_HEX[cat], color: '#000' }}
          aria-label={`Current drought category D${cat}`}
        >
          D{cat}
        </span>
      ) : (
        <span className="inline-flex h-9 w-11 flex-shrink-0 items-center justify-center rounded-md border border-forest-green/20 bg-forest-green/5 text-[11px] font-semibold text-forest-green/50 font-dm-sans">
          None
        </span>
      )}
      <div className="min-w-0">
        <p className="font-fraunces text-lg font-semibold leading-tight text-forest-green">
          {cat !== null ? `D${cat} · ${CAT_NAME[cat]}` : 'No drought'}
        </p>
        <p className="font-dm-sans text-sm text-forest-green/60">{coverage}</p>
      </div>
    </div>
  )
}

// ── Ribbon + summary: from the live 3-year weekly history (degrades independently) ──
function RibbonAndSummary({ history }: { history: DroughtHistoryWeek[] }) {
  if (history.length === 0) {
    return (
      <p className="font-dm-sans text-xs text-forest-green/40">3-year history unavailable — check back shortly.</p>
    )
  }

  const weeks = [...history].sort((a, b) => a.date.localeCompare(b.date)) // oldest → newest (left → right)

  // Worst category + when.
  let worst = -1
  let worstDate = ''
  for (const w of weeks) {
    const c = categoryOf(w.d0, w.d1, w.d2, w.d3, w.d4)
    if (c !== null && c > worst) { worst = c; worstDate = w.date }
  }

  // Months in drought (category ≥ D1), bucketed: a month counts if the MAJORITY of its
  // weeks were in drought. Out of the distinct months the history covers.
  const byMonth = new Map<string, { total: number; drought: number }>()
  for (const w of weeks) {
    const key = w.date.slice(0, 7) // YYYY-MM
    const cell = byMonth.get(key) ?? { total: 0, drought: 0 }
    cell.total++
    if ((categoryOf(w.d0, w.d1, w.d2, w.d3, w.d4) ?? -1) >= 1) cell.drought++
    byMonth.set(key, cell)
  }
  let droughtMonths = 0
  for (const { total, drought } of byMonth.values()) if (drought * 2 >= total) droughtMonths++
  const totalMonths = byMonth.size

  const summary = worst >= 0
    ? `Worst: D${worst} · ${seasonOf(worstDate)} · in drought ${droughtMonths} of last ${totalMonths} months`
    : `No drought in the last ${totalMonths} months`

  return (
    <div>
      {/* Weekly band ribbon — left = 3 yr ago → right = now. Thin equal-width cells, one
          per week, colored by category; a subtle tick at the right-third (1 year ago). */}
      <div className="relative">
        <div className="flex h-6 w-full overflow-hidden rounded-md">
          {weeks.map((w, i) => {
            const c = categoryOf(w.d0, w.d1, w.d2, w.d3, w.d4)
            return <div key={i} style={{ flex: '1 0 0', backgroundColor: c !== null ? USDM_HEX[c] : NONE_HEX }} />
          })}
        </div>
        {/* 1-year-ago tick: the recent 52 weeks are the right third (2/3 across). */}
        <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-forest-green/40" aria-hidden="true" />
      </div>
      <div className="mt-1 flex items-center justify-between font-dm-sans text-[10px] text-forest-green/45">
        <span>3 yr ago</span>
        <span>now ▲</span>
      </div>

      <p className="mt-2 font-dm-sans text-xs text-forest-green/60">{summary}</p>
    </div>
  )
}

export default function LatestReadingCard({
  latest,
  history,
}: {
  latest: Reading
  history: DroughtHistoryWeek[]
}) {
  return (
    <Card shadow="soft" className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Heading level={5}>Latest Reading</Heading>
        <span className="rounded-full bg-forest-green/10 px-3 py-1 text-xs font-medium text-forest-green font-dm-sans">
          Week of {formatWeek(latest.week_date)}
        </span>
      </div>

      <Hero latest={latest} />

      <div className="mt-4">
        <RibbonAndSummary history={history} />
      </div>

      <p className="mt-3 text-xs text-forest-green/40 font-dm-sans">
        Source:{' '}
        <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener noreferrer" className="underline">
          U.S. Drought Monitor
        </a>
      </p>
    </Card>
  )
}
