import type { SupabaseClient } from '@supabase/supabase-js'
import { getRanchLots } from './herd-lots'
import { getHayLedger } from './hay/queries'
import { getRainLedger } from './rain/queries'
import { getPrecipNormal } from './precip-normal'
import { LOT_CLASS_LABELS, type LotClass } from './herd'
import { ranchYearStart } from './jobs/format'
import { createServiceClient } from './supabase'

// ─── The Ranch view's three numbers (Block 47) ───────────────────────────────
// Head, bales on hand with days of feed left, rain this season against normal
// — the three a person reads standing in a pickup. Each carries the arithmetic
// and the records beneath it, so the page can open the layer under a number
// on a tap. A number that cannot be honestly derived is NULL and is not
// painted; days of feed left in particular is withheld, with the reason,
// rather than guessed — a wrong rate makes a right-looking number.

export interface HeadNumber {
  total: number
  byClass: { label: string; head: number; bunches: number }[]
  bunches: number
}

export interface HayNumber {
  onHand: number
  baselineAsOf: string
  countedBales: number
  stackedSince: number
  fedSince: number
  /** Days left at the trailing rate, or why it is withheld. */
  daysLeft: number | null
  withheld: 'thin_feeding' | 'no_recent_feeding' | 'nothing_left' | null
  rate: { balesPerDay: number; windowDays: number; daysWithEntries: number; bales: number } | null
  /** Feed used this season — bales fed since the ranch year began (reference, under the tap). */
  fedThisSeason: { bales: number; entries: number; days: number } | null
}

export interface RainNumber {
  recorded: number
  entries: number
  places: number
  normal: number | null
  normalSource: string | null
  year: string
}

export interface RanchView {
  head: HeadNumber | null
  hay: HayNumber | null
  rain: RainNumber | null
  acresByKind: { kind: string; acres: number; places: number }[]
}

export async function ranchView(supabase: SupabaseClient, userId: string): Promise<RanchView> {
  const [lots, ledger, rain, home, places] = await Promise.all([
    getRanchLots(supabase, userId).catch(() => [] as Awaited<ReturnType<typeof getRanchLots>>),
    getHayLedger(supabase, { sinceWithoutBaseline: ranchYearStart() }).catch(() => null),
    getRainLedger(supabase).catch(() => null),
    (async () => { try { const { data } = await supabase.from('profiles').select('home_county_fips').eq('id', userId).maybeSingle(); return (data as { home_county_fips?: string | null } | null)?.home_county_fips ?? null } catch { return null } })(),
    (async () => { try { const { data } = await supabase.from('places').select('kind, acres').is('retired_at', null).is('deleted_at', null); return (data ?? []) as { kind: string; acres: number | null }[] } catch { return [] as { kind: string; acres: number | null }[] } })(),
  ])

  // Head — only with a live bunch; the projection (anchors + group actions) is what each bunch says.
  let head: HeadNumber | null = null
  if (lots.length > 0) {
    const by = new Map<string, { head: number; bunches: number }>()
    for (const l of lots) { const k = l.class; const e = by.get(k) ?? { head: 0, bunches: 0 }; e.head += l.head_count; e.bunches += 1; by.set(k, e) }
    head = {
      total: lots.reduce((n, l) => n + l.head_count, 0),
      bunches: lots.length,
      byClass: [...by.entries()].sort((a, b) => b[1].head - a[1].head).map(([k, v]) => ({ label: LOT_CLASS_LABELS[k as LotClass] ?? k, head: v.head, bunches: v.bunches })),
    }
  }

  // Hay — only with a counted baseline (never stacked − fed alone).
  let hay: HayNumber | null = null
  const s = ledger?.summary
  if (s?.onHand) {
    const r = s.runOut
    hay = {
      onHand: s.onHand.bales,
      baselineAsOf: s.onHand.baseline.asOf,
      countedBales: s.onHand.baseline.bales,
      stackedSince: s.onHand.stackedSince.bales,
      fedSince: s.onHand.fedSince.bales,
      daysLeft: r.date ? r.daysLeft : null,
      withheld: r.date ? null : (r.withheld === 'no_baseline' ? null : (r.withheld ?? null)),
      rate: s.burnRate ? { balesPerDay: s.burnRate.balesPerDay, windowDays: s.burnRate.windowDays, daysWithEntries: s.burnRate.daysWithEntries, bales: s.burnRate.bales } : null,
      fedThisSeason: s.fed ? { bales: s.fed.bales, entries: s.fed.entries, days: s.fed.days } : null,
    }
  }

  // Rain — recorded on the ranch's places this season; the county normal to date beside it when the county is known.
  let rainNumber: RainNumber | null = null
  if (rain && rain.ytd.entries > 0) {
    let normal: number | null = null, normalSource: string | null = null
    if (home) {
      try {
        const { data: county } = await createServiceClient().from('counties').select('fips, lat, lon').eq('fips', home).maybeSingle()
        const c = county as { fips: string; lat: number | null; lon: number | null } | null
        if (c) {
          const p = await getPrecipNormal(c.fips, c.lat, c.lon)
          if (p && typeof p === 'object') { normal = p.ytdNormal; normalSource = p.label }
        }
      } catch { /* the normal is a courtesy; recorded rain stands on its own */ }
    }
    rainNumber = { recorded: rain.ytd.inches, entries: rain.ytd.entries, places: rain.places.filter(p => p.place_id).length, normal, normalSource, year: rain.ytd.year }
  }

  // Acres by kind — drawn ground only (reference, under Ground).
  const acres = new Map<string, { acres: number; places: number }>()
  for (const p of places) { if (typeof p.acres !== 'number') continue; const e = acres.get(p.kind) ?? { acres: 0, places: 0 }; e.acres += p.acres; e.places += 1; acres.set(p.kind, e) }
  const acresByKind = [...acres.entries()].sort((a, b) => b[1].acres - a[1].acres).map(([kind, v]) => ({ kind, acres: v.acres, places: v.places }))

  return { head, hay, rain: rainNumber, acresByKind }
}
