import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import { LedgerPanel } from './LedgerTabs'
import { fmtDay, fmtTime, plural, ranchYearStart } from '@/lib/jobs/format'
import { isManualEventType, MANUAL_EVENT_LABELS, MANUAL_EVENT_TYPES } from '@/lib/manual-log'
import { lotLabel, type Lot } from '@/lib/herd'

// "Recently logged" — the last three lines the operator wrote by hand, newest
// first, plain language, place name when one was given. Reads events
// directly (payload->>source = 'manual') on the user-scoped client — the 034
// SELECT policy is the scope. If there are none the section does not render:
// no empty state, no zero (summary never says more than the ledger does).

// Three lines (flow, commit 5; was ten): the ledger's most recent breath, not a
// log. No "see all" — there is no full manual-log view to link to yet.
const FEED_CAP = 3

type Row = {
  id: string
  type: string
  ts: string
  payload: Record<string, unknown>
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function line(r: Row, placeName: (id: unknown) => string | null, lotName: (id: unknown) => string | null): string {
  const p = r.payload
  const at = placeName(p.place_id)
  const suffix = at ? ` at ${at}` : ''
  switch (r.type) {
    case 'rain': {
      const inches = num(p.inches)
      return inches == null ? `Rain${suffix}` : `${inches.toFixed(2)}" of rain${suffix}`
    }
    case 'hay_fed': {
      const bales = num(p.bales)
      // "to <lot>" only when the line carries a lot that still exists in the herd.
      const to = lotName(p.herd_lot_id)
      const who = to ? ` to ${to}` : ''
      return bales == null ? `Hay fed${who}${suffix}` : `Fed ${plural(bales, 'bale')}${who}${suffix}`
    }
    case 'bales_stacked': {
      const count = num(p.count)
      return count == null ? `Bales stacked${suffix}` : `Stacked ${plural(count, 'bale')}${suffix}`
    }
    case 'cattle_moved': {
      const head = num(p.head)
      const from = placeName(p.from_place_id)
      const to = placeName(p.to_place_id)
      const who = head == null ? 'Cattle' : `${head.toLocaleString()} head`
      const route = from && to ? ` ${from} → ${to}` : to ? ` to ${to}` : from ? ` from ${from}` : ''
      return `Moved ${who}${route}`
    }
    case 'cattle_worked': {
      const head = num(p.head)
      const what = str(p.what)
      const who = head == null ? 'cattle' : `${head.toLocaleString()} head`
      return `${what ? what[0].toUpperCase() + what.slice(1) : 'Worked'} ${who}${suffix}`
    }
    case 'hay_inventory': {
      const bales = num(p.bales)
      const asOf = str(p.as_of)
      const when = asOf ? ` as of ${fmtDay(`${asOf}T12:00:00-06:00`)}` : ''
      return bales == null ? `Bales on hand counted${when}` : `${plural(bales, 'bale')} on hand${when}${suffix}`
    }
    default:
      return (isManualEventType(r.type) ? MANUAL_EVENT_LABELS[r.type] : r.type) + suffix
  }
}

// `heading` (views2, commit 5): inside the ledger tab strip the tab is the
// label, so the card's own title is dropped; anywhere else it keeps it.
export default async function RecentlyLogged({ heading = true }: { heading?: boolean } = {}) {
  const supabase = await createClient()
  // Bounded: the manual types by name (an indexable predicate ahead of the
  // jsonb source check) and this ranch year as the floor — the season the
  // rest of /home is scoped to. Cap unchanged.
  const { data } = await supabase
    .from('events')
    .select('id, type, ts, payload')
    .in('type', [...MANUAL_EVENT_TYPES])
    .eq('payload->>source', 'manual')
    .gte('ts', ranchYearStart())
    .order('ts', { ascending: false })
    .limit(FEED_CAP)
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return <LedgerPanel tab="logged" empty />

  // Resolve place names in one query; unknown ids just print without a place.
  const ids = new Set<string>()
  for (const r of rows) {
    for (const k of ['place_id', 'from_place_id', 'to_place_id']) {
      const v = str(r.payload[k]); if (v) ids.add(v)
    }
  }
  const names = new Map<string, string>()
  if (ids.size > 0) {
    const { data: places } = await supabase.from('places').select('id, name').in('id', [...ids])
    for (const p of places ?? []) names.set(p.id, p.name)
  }
  const placeName = (id: unknown) => { const s = str(id); return s ? names.get(s) ?? null : null }

  // Lot labels for hay_fed lines that name a lot — one RLS-scoped read of the
  // caller's own herd, only when some line needs it; labeled by lotLabel (the
  // producer's name, else the class), the same words the herd page uses.
  const lotIds = new Set<string>()
  for (const r of rows) { if (r.type === 'hay_fed') { const v = str(r.payload.herd_lot_id); if (v) lotIds.add(v) } }
  const lotNames = new Map<string, string>()
  if (lotIds.size > 0) {
    const { data: profile } = await supabase.from('operation_profiles').select('herd').maybeSingle()
    const lots = (profile?.herd as { lots?: Lot[] } | null)?.lots
    for (const l of Array.isArray(lots) ? lots : []) if (lotIds.has(l.id)) lotNames.set(l.id, lotLabel(l))
  }
  const lotName = (id: unknown) => { const s = str(id); return s ? lotNames.get(s) ?? null : null }

  return (
    <LedgerPanel tab="logged" empty={false}>
    <Card shadow="none" className="px-5 py-4">
      {heading && <Heading level={5}>Recently logged</Heading>}
      <ul className={`${heading ? 'mt-2 ' : ''}divide-y divide-forest-green/10`}>
        {rows.map(r => {
          const pid = str(r.payload.place_id) ?? str(r.payload.to_place_id)
          const linked = pid && names.has(pid)
          return (
            <li key={r.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="font-dm-sans text-[17px] text-forest-green">
                {line(r, placeName, lotName)}
                {linked && <Link href={`/places/${pid}`} className="ml-2 font-semibold text-forest-green underline underline-offset-2">place →</Link>}
              </span>
              <span className="shrink-0 font-dm-sans text-[15px] tabular-nums text-forest-green/80">
                {fmtDay(r.ts)} · {fmtTime(r.ts)}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
    </LedgerPanel>
  )
}
