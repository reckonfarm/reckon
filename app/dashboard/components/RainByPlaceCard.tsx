import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import { getRainLedger } from '@/lib/rain/queries'
import { fmtDay } from '@/lib/jobs/format'
import type { PrecipNormalResult } from '@/lib/precip-normal'

// ─── Rain by place — what you measured, beside what the county estimate says ──
// Weather view only. Self-contained server component on the USER-SCOPED
// client (JobsView's shape): the dashboard is public, the ranch ledger is
// not — signed out renders nothing here (the rainfall panel above already
// serves every visitor; a "private" gate under it on a public county page is
// noise, and there is nothing to fake-empty: the card is absent by doctrine
// for most visitors anyway).
//
// Two kinds of fact, kept apart on purpose:
//   * MEASURED — gauge readings the operator logged, per place, year to date,
//     each with its entry count. Ground truth for that spot.
//   * ESTIMATED — the county year-to-date vs normal the page already fetched
//     (lib/precip-normal): a NOAA station N miles off, or a PRISM county
//     estimate. Shown with its own provenance label, never subtracted from
//     or reconciled with the readings.
// Absence doctrine, strictly: fewer than MIN_ENTRIES readings → no card. A
// place with no readings this year does not render. No zeros anywhere.

const MIN_ENTRIES = 3

function inches(n: number): string {
  return `${n.toFixed(2)}"`
}

const readings = (n: number) => `${n} reading${n === 1 ? '' : 's'}`

export default async function RainByPlaceCard({ precipPromise }: { precipPromise: Promise<PrecipNormalResult> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const ledger = await getRainLedger(supabase)
  if (ledger.entries.length < MIN_ENTRIES) return null

  const rows = ledger.places.filter(p => p.ytd.entries > 0)
  if (rows.length === 0) return null

  // The county figure is whatever the page already resolved — no new fetch.
  // Any non-series state (unavailable / no station / none) simply leaves the
  // estimate line out; the readings stand on their own.
  const precip = await precipPromise
  const estimate = precip && typeof precip === 'object' && precip.ytdNormal > 0 ? precip : null

  return (
    <Card shadow="none" className="px-5 py-4">
      <p className="font-dm-sans text-xs font-medium uppercase tracking-wide text-forest-green/40">
        Rain you measured · {ledger.ytd.year}
      </p>
      <ul className="mt-3 divide-y divide-forest-green/10">
        {rows.map(p => (
          <li key={p.place_id ?? 'none'} className="flex items-baseline justify-between gap-3 py-2">
            <span className="font-dm-sans text-sm text-forest-green">
              {p.name ?? (p.place_id ? 'Unnamed place' : 'No place given')}
            </span>
            <span className="shrink-0 text-right">
              <span className="font-fraunces text-lg font-semibold tabular-nums text-forest-green">{inches(p.ytd.inches)}</span>
              <span className="ml-2 font-dm-sans text-xs text-forest-green/50">{readings(p.ytd.entries)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 font-dm-sans text-xs text-forest-green/40">
        Gauge readings you logged, added up by place · since {fmtDay(ledger.entries[0].ts)}.
      </p>

      {estimate && (
        <div className="mt-4 border-t border-forest-green/10 pt-3">
          <p className="font-dm-sans text-xs font-medium uppercase tracking-wide text-forest-green/40">
            County estimate · not a gauge
          </p>
          <p className="mt-1 font-dm-sans text-sm text-forest-green/70">
            <span className="font-semibold tabular-nums text-forest-green">{inches(estimate.ytdActual)}</span>
            {' '}this year vs {inches(estimate.ytdNormal)} normal ·{' '}
            <span className="tabular-nums">{Math.round((estimate.ytdActual / estimate.ytdNormal) * 100)}%</span> of normal
          </p>
          <p className="mt-0.5 font-dm-sans text-[11px] text-forest-green/40">
            {estimate.source === 'grid'
              ? 'PRISM county estimate — modeled, not measured'
              : `${estimate.label}, ${estimate.distanceMiles} mi from the county center${estimate.outOfCounty ? ', outside the county' : ''}`}
            {estimate.dataThrough ? ` · through ${fmtDay(`${estimate.dataThrough}T12:00:00-06:00`)}` : ''}.
            {' '}A different kind of number from your gauges — shown for context, never combined.
          </p>
        </div>
      )}
    </Card>
  )
}
