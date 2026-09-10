import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import Disclosure from '@/app/components/ui/Disclosure'
import { getRainLedger, type RainEntry } from '@/lib/rain/queries'
import { fmtDay } from '@/lib/jobs/format'
import LogRainButton from './LogRainButton'

// ─── Rain on my places (Block 7, Part 3) ──────────────────────────────────────
// The one thing no forecast app can copy: Haley read the gauge at the north
// place on Tuesday. Built from what the ranch already has — places, the rain
// ledger, the people on it. Every place gets a row, in the order of the places
// list. The row's answer is the LATEST reading: inches · day · who recorded it.
// Rules held hard:
//   · a missing reading is missing, never zero — "no rain recorded yet" and
//     "nothing recorded since Aug 10" are about the record, and neither one
//     says no rain fell
//   · totals are "Recorded rain", never "rainfall"
//   · who recorded it is part of the answer, the same as the feeding handoff
// Each row expands to its history; Log rain sits with the section and with
// each row (the sheet opens on Rain with that place chosen).

const inches = (n: number) => `${n.toFixed(2)}"`
const STALE_DAYS = 7

export default async function RainOnMyPlaces({ user }: { user: { id: string } | null }) {
  if (!user) return null
  const supabase = await createClient()
  const [ledger, placesRes] = await Promise.all([
    getRainLedger(supabase),
    // Live only — each row offers Log rain, and nothing new is recorded at a
    // retired place. Tolerant of a database without 057: every place is live there.
    supabase.from('places').select('id, name').is('retired_at', null).order('name')
      .then(r => (r.error ? supabase.from('places').select('id, name').order('name') : r)),
  ])
  const places = ((placesRes.data ?? []) as { id: string; name: string }[])
  const noPlace = ledger.places.find(p => p.place_id === null) ?? null
  if (places.length === 0 && !noPlace) return null

  // Who recorded it: display names through the service role (profiles is not ranch-scoped), only for the ids on these readings.
  const userIds = [...new Set(ledger.entries.map(e => e.user_id).filter((v): v is string => !!v))]
  const { data: profiles } = userIds.length ? await createServiceClient().from('profiles').select('id, display_name, email').in('id', userIds) : { data: [] as { id: string; display_name: string | null; email: string | null }[] }
  const who = (id: string | null) => {
    const p = (profiles ?? []).find(x => x.id === id)
    return (p?.display_name as string | null)?.trim() || (p?.email as string | null)?.split('@')[0] || 'someone on the ranch'
  }
  const byPlace = new Map(ledger.places.map(p => [p.place_id, p]))
  const now = Date.now()
  const stale = (e: RainEntry) => now - Date.parse(e.ts) > STALE_DAYS * 86_400_000
  const rows = [
    ...places.map(pl => ({ id: pl.id as string | null, name: pl.name, rain: byPlace.get(pl.id) ?? null })),
    ...(noPlace ? [{ id: null as string | null, name: 'No place given', rain: noPlace }] : []),
  ]

  return (
    <section aria-labelledby="wx-rain-h" data-audit="rain-on-my-places">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="wx-rain-h" className={`${EYEBROW} !text-ink`}>Rain on my places</h2>
        <LogRainButton />
      </div>
      <Card shadow="none" className="px-5 py-2">
        <ul className="divide-y divide-forest-green/10" data-audit="recorded-rain">
          {rows.map(r => {
            const latest = r.rain?.latest ?? null
            return (
              <li key={r.id ?? 'none'} className="py-3" data-audit="rain-place-row" data-place={r.id ?? 'none'} data-state={latest ? 'read' : 'none'}>
                <p className="font-dm-sans text-[17px] text-ink">
                  <span className="font-semibold">{r.name}</span>
                  {latest
                    ? <> — <span className="tabular-nums" data-audit="rain-latest">{inches(latest.inches)}</span> · {fmtDay(latest.ts)} · recorded by <span data-audit="rain-who">{who(latest.user_id)}</span></>
                    : <> — <span data-audit="rain-none">no rain recorded yet</span></>}
                </p>
                {latest && r.rain && (
                  <p className="mt-0.5 font-dm-sans text-[15px] text-secondary-ink">
                    Recorded rain this year: <span className="tabular-nums">{inches(r.rain.ytd.inches)}</span> · {r.rain.ytd.entries} {r.rain.ytd.entries === 1 ? 'reading' : 'readings'}
                    {stale(latest) ? <> · <span data-audit="rain-since">nothing recorded since {fmtDay(latest.ts)}</span></> : null}
                  </p>
                )}
                {!latest && <p className="mt-0.5 font-dm-sans text-[15px] text-secondary-ink">No reading here yet — that is a missing reading, not zero rain.</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-4">
                  {r.rain && (
                    <Disclosure title="History" audit={`rain-history-${r.id ?? 'none'}`} className="mt-1 w-full" summary={`${r.rain.total.entries} ${r.rain.total.entries === 1 ? 'reading' : 'readings'} since ${fmtDay(r.rain.first)} · ${inches(r.rain.total.inches)} recorded in all`}>
                      <ol className="divide-y divide-forest-green/10" data-audit="rain-readings">
                        {r.rain.readings.map(e => (
                          <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 font-dm-sans text-[16px] text-ink">
                            <span>{fmtDay(e.ts)} · recorded by {who(e.user_id)}</span>
                            <span className="tabular-nums font-semibold">{inches(e.inches)}</span>
                          </li>
                        ))}
                      </ol>
                    </Disclosure>
                  )}
                  {r.id && <LogRainButton placeId={r.id} placeName={r.name} compact />}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
      <p className="mt-2 font-dm-sans text-[14px] text-secondary-ink">Recorded rain is what someone on the ranch read off a gauge and logged. A place with no reading has no reading — that is not zero rain.</p>
    </section>
  )
}
