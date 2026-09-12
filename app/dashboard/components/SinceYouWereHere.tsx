import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { fmtDay, fmtTime, dayKey, todayKey, plural } from '@/lib/jobs/format'
import { MANUAL_EVENT_TYPES, MANUAL_EVENT_LABELS, isManualEventType } from '@/lib/manual-log'
import { lotLabel, type Lot } from '@/lib/herd'
import { getRanchLots } from '@/lib/herd-lots'
import ReviewedButton from '@/app/components/ReviewedButton'
import { ledgerFilters } from '@/lib/ledger-effective'
import ActivityRowItem from '@/app/components/ActivityRowItem'
import { hasEventDeletion } from '@/lib/schema-capability'

// ─── Since you last checked (Block 2E) ────────────────────────────────────────
// What the OTHER people (and the alert service) put in the ranch ledger since
// this person's last visit: who, when, what changed — each line a link to the
// underlying record (the place page when the entry names a place, else the
// ledger tabs). Sourced from events whose INGESTED time is after
// ranch_members.last_seen_at (044) — an entry synced late from a phone still
// counts as news — shown with the time it HAPPENED. The person's own entries
// are not news to them. Nothing new → the block does not render at all.
// Seen is not done, and seen is not "the page loaded" (6H): the boundary moves only
// when the person presses Reviewed with every entry in front of them.

// Block 6A: 3–5 rows on Today, the rest behind "View all N updates" (the record, filtered to the same window).
const SHOW = 5
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

interface Row { id: string; user_id: string; type: string; ts: string; ingested_at: string; payload: Record<string, unknown>; supersedes_event_id: string | null; voided_at: string | null }

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

// The work day on every line (5F): "today 6:01 PM", "yesterday 6:01 PM", "Sep 1 6:01 PM".
function when(iso: string): string {
  const d = dayKey(iso)
  if (d === todayKey()) return `today ${fmtTime(iso)}`
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

  // Block 5B: a correction or a void recorded since the visit IS news (its
  // ingested_at is now, whatever day the work was); the original it replaced
  // is not — its replacement speaks for it.
  // 7D: skip the deleted filter on a database without 061 (temporary).
  const { notSuperseded } = ledgerFilters(await hasEventDeletion(supabase))
  const [{ data }, { count }] = await Promise.all([
    notSuperseded(supabase
      .from('events')
      .select('id, user_id, type, ts, ingested_at, payload, supersedes_event_id, voided_at')
      .in('type', [...MANUAL_EVENT_TYPES, 'alert']))
      .gt('ingested_at', since)
      .neq('user_id', user.id)
      .order('ingested_at', { ascending: false })
      .limit(SHOW),
    notSuperseded(supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .in('type', [...MANUAL_EVENT_TYPES, 'alert']))
      .gt('ingested_at', since)
      .neq('user_id', user.id),
  ])
  const rows = (data ?? []) as Row[]
  const total = count ?? rows.length
  // Block 6A copy: nothing new is said in words, never "All work complete".
  if (rows.length === 0) {
    return (
      <Card shadow="soft" className="p-4 sm:p-5" data-audit="since-empty">
        <p className={EYEBROW}>Recorded since you checked</p>
        <p className="mt-2 font-dm-sans text-[16px] text-secondary-ink">No new crew entries since your last review{lastSeen ? ` (${when(lastSeen)})` : ''}.</p>
        <Link href="/ranch/activity" className="mt-1 inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="since-recent-link">Recent crew entries →</Link>
      </Card>
    )
  }

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
    lotIds.size ? getRanchLots(supabase, user.id) : Promise.resolve([] as Lot[]),
  ])
  const placeNames = new Map((placesRes.data ?? []).map(p => [p.id as string, p.name as string]))
  const authors = new Map((profilesRes.data ?? []).map(p => [p.id as string, (p.display_name as string | null)?.trim() || null]))
  const lotNames = new Map(herdRes.map(l => [l.id, lotLabel(l)]))   // the RANCH's lots (Block 4A), so a hand's feeding keeps its name for everyone
  const placeName = (id: unknown) => { const s = str(id); return s ? placeNames.get(s) ?? null : null }
  const lotName = (id: unknown) => { const s = str(id); return s ? lotNames.get(s) ?? null : null }

  return (
    <Card shadow="soft" className="p-4 sm:p-5">
      <p className={EYEBROW}>Recorded since you checked</p>
      <ul className="mt-3 divide-y divide-forest-green/10">
        {rows.map(r => {
          const author = r.type === 'alert' ? 'Dryline' : (authors.get(r.user_id) ?? 'Someone on the ranch')
          // Block 5A — the row opens ITS exact event by stable id, never a place summary.
          const href = `/ranch/activity/${r.id}`
          void href
          // 6B: the same row component as every timeline — a correction or a void is marked, not prefixed.
          return <ActivityRowItem key={r.id} id={r.id} who={author} line={what(r, placeName, lotName)} when={when(r.ts)} marker={r.voided_at ? 'voided' : r.supersedes_event_id ? 'corrected' : null} chain={[]} audit="since-row" rowClass="py-2" sep=" " />
        })}
      </ul>
      {/* Block 5F: the list is by when it was RECORDED; each line shows the day the work
          was done — so an entry logged today for Tuesday's feeding rightly appears here,
          dated Tuesday. */}
      <p className="mt-2 font-dm-sans text-[14px] text-secondary-ink" data-audit="since-note">Newest recorded first · each line shows when the work was done{lastSeen ? '' : ' · since yesterday'}.</p>
      {/* 6H: Reviewed only when every entry is on this card; otherwise the whole list carries it. */}
      {total <= rows.length && <ReviewedButton count={total} />}
      {total > rows.length && (
        <Link href={`/ranch/activity?since=${encodeURIComponent(since)}`} className="mt-1 inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="since-view-all">View all {total} updates →</Link>
      )}
    </Card>
  )
}
