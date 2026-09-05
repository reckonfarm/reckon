import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { fmtDay, fmtTime, dayKey, todayKey, plural } from '@/lib/jobs/format'
import { MANUAL_EVENT_TYPES, MANUAL_EVENT_LABELS, isManualEventType } from '@/lib/manual-log'
import { lotLabel, type Lot } from '@/lib/herd'
import LastSeenPing from './LastSeenPing'

// ─── Since you last checked (Block 2E) ────────────────────────────────────────
// What the OTHER people (and the alert service) put in the ranch ledger since
// this person's last visit: who, when, what changed — each line a link to the
// underlying record (the place page when the entry names a place, else the
// ledger tabs). Sourced from events whose INGESTED time is after
// ranch_members.last_seen_at (044) — an entry synced late from a phone still
// counts as news — shown with the time it HAPPENED. The person's own entries
// are not news to them. Nothing new → the block does not render at all.
// Seen is not done: LastSeenPing marks the visit; nothing here completes.

const CAP = 12
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

interface Row { id: string; user_id: string; type: string; ts: string; ingested_at: string; payload: Record<string, unknown> }

function what(r: Row, placeName: (id: unknown) => string | null, lotName: (id: unknown) => string | null): string {
  const p = r.payload
  const at = placeName(p.place_id)
  const suffix = at ? ` at ${at}` : ''
  switch (r.type) {
    case 'hay_fed': {
      const b = num(p.bales); const to = lotName(p.herd_lot_id)
      return `fed ${b == null ? 'hay' : plural(b, 'bale')}${to ? ` to ${to}` : ''}${suffix}`
    }
    case 'bales_stacked': { const c = num(p.count); return `stacked ${c == null ? 'bales' : plural(c, 'bale')}${suffix}` }
    case 'hay_inventory': { const b = num(p.bales); const asOf = str(p.as_of); return `counted ${b == null ? 'the stack' : `${b.toLocaleString()} bales on hand`}${asOf ? ` as of ${fmtDay(`${asOf}T12:00:00-06:00`)}` : ''}${suffix}` }
    case 'rain': { const i = num(p.inches); return `logged ${i == null ? 'rain' : `${i.toFixed(2)}" of rain`}${suffix}` }
    case 'cattle_moved': {
      const h = num(p.head); const from = placeName(p.from_place_id); const to = placeName(p.to_place_id)
      return `moved ${h == null ? 'cattle' : `${h.toLocaleString()} head`}${from && to ? ` ${from} → ${to}` : to ? ` to ${to}` : from ? ` from ${from}` : ''}`
    }
    case 'cattle_worked': { const h = num(p.head); const w = str(p.what); return `${w ?? 'worked'} ${h == null ? 'cattle' : `${h.toLocaleString()} head`}${suffix}` }
    case 'alert': return `LFP alert for ${str(p.county_name) ?? 'a county'}${num(p.tier) ? ` — tier ${p.tier}` : ''}`
    default: return (isManualEventType(r.type) ? MANUAL_EVENT_LABELS[r.type] : r.type) + suffix
  }
}

const isoHoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString()

function when(iso: string): string {
  const d = dayKey(iso)
  if (d === todayKey()) return fmtTime(iso)
  if (d === dayKey(Date.now() - 86_400_000)) return `yesterday ${fmtTime(iso)}`
  return `${fmtDay(iso)} ${fmtTime(iso)}`
}

export default async function SinceYouWereHere() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: member } = await supabase
    .from('ranch_members')
    .select('ranch_id, last_seen_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!member) return null
  const lastSeen = (member as { last_seen_at?: string | null }).last_seen_at ?? null
  const since = lastSeen ?? isoHoursAgo(24)

  const { data } = await supabase
    .from('events')
    .select('id, user_id, type, ts, ingested_at, payload')
    .in('type', [...MANUAL_EVENT_TYPES, 'alert'])
    .gt('ingested_at', since)
    .neq('user_id', user.id)
    .order('ingested_at', { ascending: false })
    .limit(CAP)
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return <LastSeenPing />

  // Names: places through RLS; authors' display names through the service
  // role (profiles is not ranch-scoped) — only for user ids that appear here.
  const placeIds = new Set<string>(); const lotIds = new Set<string>(); const userIds = new Set<string>()
  for (const r of rows) {
    userIds.add(r.user_id)
    for (const k of ['place_id', 'from_place_id', 'to_place_id']) { const v = str(r.payload[k]); if (v) placeIds.add(v) }
    const l = str(r.payload.herd_lot_id); if (l) lotIds.add(l)
  }
  const [placesRes, profilesRes, herdRes] = await Promise.all([
    placeIds.size ? supabase.from('places').select('id, name').in('id', [...placeIds]) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    createServiceClient().from('profiles').select('id, display_name').in('id', [...userIds]),
    lotIds.size ? supabase.from('operation_profiles').select('herd').eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const placeNames = new Map((placesRes.data ?? []).map(p => [p.id as string, p.name as string]))
  const authors = new Map((profilesRes.data ?? []).map(p => [p.id as string, (p.display_name as string | null)?.trim() || null]))
  const lots = (herdRes.data as { herd?: { lots?: Lot[] } } | null)?.herd?.lots
  const lotNames = new Map((Array.isArray(lots) ? lots : []).map(l => [l.id, lotLabel(l)]))
  const placeName = (id: unknown) => { const s = str(id); return s ? placeNames.get(s) ?? null : null }
  const lotName = (id: unknown) => { const s = str(id); return s ? lotNames.get(s) ?? null : null }

  return (
    <Card shadow="soft" className="p-4 sm:p-5">
      <LastSeenPing />
      <p className={EYEBROW}>{lastSeen ? 'Since you last checked' : 'Since yesterday'}</p>
      <ul className="mt-3 divide-y divide-forest-green/10">
        {rows.map(r => {
          const author = r.type === 'alert' ? 'Dryline' : (authors.get(r.user_id) ?? 'Someone on the ranch')
          const placeId = str(r.payload.place_id) ?? str(r.payload.to_place_id)
          const href = placeId && placeNames.has(placeId) ? `/places/${placeId}` : '#ledgers'
          return (
            <li key={r.id}>
              <Link href={href} className="flex min-h-[56px] items-center justify-between gap-3 py-2">
                <span className="font-dm-sans text-[17px] leading-snug text-forest-green">
                  <span className="font-semibold">{author}</span> {what(r, placeName, lotName)}
                </span>
                <span className="shrink-0 font-dm-sans text-[15px] tabular-nums text-forest-green/80">{when(r.ts)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
