import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import { getRainLedger } from '@/lib/rain/queries'
import { fmtDay } from '@/lib/jobs/format'
import type { PrecipNormalResult } from '@/lib/precip-normal'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

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
// Absence doctrine, strictly: no reading this year → no card. A place with
// no readings this year does not render. No zeros anywhere.

function inches(n: number): string {
  return `${n.toFixed(2)}"`
}

const readings = (n: number) => `${n} reading${n === 1 ? '' : 's'}`

// `user` is the page's already-resolved session (one getUser per request). Signed
// out → null → nothing, exactly as before; the client minted here is for the
// RLS-scoped ledger read only (a cookie read, not an auth round-trip).
export default async function RainByPlaceCard({ precipPromise, user }: {
  precipPromise: Promise<PrecipNormalResult>
  user: { id: string } | null
}) {
  if (!user) return null
  const supabase = await createClient()

  const ledger = await getRainLedger(supabase)
  if (ledger.ytd.entries === 0) return null

  const rows = ledger.places.filter(p => p.ytd.entries > 0)
  if (rows.length === 0) return null
  // Places with no reading this year are named as such — a stated absence, never a zero (Block 6B).
  const { data: allPlaces } = await supabase.from('places').select('id, name').order('name')
  const unread = ((allPlaces ?? []) as { id: string; name: string }[]).filter(pl => !rows.some(r => r.place_id === pl.id))

  // The county figure is whatever the page already resolved — no new fetch.
  // Any non-series state (unavailable / no station / none) simply leaves the
  // estimate line out; the readings stand on their own.
  const precip = await precipPromise
  const estimate = precip && typeof precip === 'object' && precip.ytdNormal > 0 ? precip : null

  return (
    <Card shadow="none" className="px-5 py-4">
      <h2 className={`${EYEBROW} !text-ink`} id="wx-rain-h">
        Recorded rain at my places · {ledger.ytd.year}
      </h2>
      <ul className="mt-3 divide-y divide-forest-green/10" aria-labelledby="wx-rain-h" data-audit="recorded-rain">
        {rows.map(p => (
          <li key={p.place_id ?? 'none'} className="flex items-baseline justify-between gap-3 py-2" data-audit="recorded-rain-row">
            <span className="font-dm-sans text-[16px] text-forest-green">
              Recorded rain at {p.name ?? (p.place_id ? 'an unnamed place' : 'no place given')}
            </span>
            <span className="shrink-0 text-right">
              <span className="font-fraunces text-lg font-semibold tabular-nums text-forest-green">{inches(p.ytd.inches)}</span>
              <span className="ml-2 font-dm-sans text-[14px] text-secondary-ink">{readings(p.ytd.entries)}{p.ytd.inches === 0 ? ' · zero measured' : ''}</span>
            </span>
          </li>
        ))}
        {unread.map(pl => (
          <li key={pl.id} className="flex items-baseline justify-between gap-3 py-2" data-audit="recorded-rain-none">
            <span className="font-dm-sans text-[16px] text-forest-green">Recorded rain at {pl.name}</span>
            <span className="shrink-0 font-dm-sans text-[14px] text-secondary-ink">No reading recorded this year</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 font-dm-sans text-[14px] text-secondary-ink">
        Source: gauge readings you logged by hand, added up by place · since {fmtDay(ledger.entries[0].ts)}. A place with no line has no gauge reading — that is not zero rain.
      </p>

      {estimate && (
        <div className="mt-4 border-t border-forest-green/10 pt-3">
          <p className={EYEBROW}>
            County estimate · not a gauge
          </p>
          <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">
            <span className="font-semibold tabular-nums text-forest-green">{inches(estimate.ytdActual)}</span>
            {' '}this year vs {inches(estimate.ytdNormal)} normal ·{' '}
            <span className="tabular-nums">{Math.round((estimate.ytdActual / estimate.ytdNormal) * 100)}%</span> of normal
          </p>
          <p className="mt-0.5 font-dm-sans text-[14px] text-secondary-ink">
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
