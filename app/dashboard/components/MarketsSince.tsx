import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { fmtDay } from '@/lib/jobs/format'
import { BARN_GEO } from '@/lib/barn-geo'
import LastSeenPing from './LastSeenPing'

// ─── Since you last checked · Markets (Block 2.5 B7) ──────────────────────────
// What arrived in the snapshot tables after this member's last Markets visit
// (ranch_members.markets_seen_at, migration 048): a new report at the pinned
// or nearest barn, a new national week, a new LRP effective date. Quiet days
// say quiet things — "Your latest local reference is from Thursday" is a
// legitimate state. Nothing here manufactures movement; there is no "prices
// moved" line, only "a new report is in".

// Date-only values render at ranch noon so the shared formatter never slides
// a UTC midnight back to the previous evening (the hay card's convention).
const day = (iso: string) => fmtDay(`${iso}T12:00:00-06:00`)
const DOW = (iso: string) => new Date(`${iso}T12:00:00-06:00`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Denver' })

export default async function MarketsSince({ localSlug, pinned }: { localSlug: string | null; pinned: boolean }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: member, error } = await supabase.from('ranch_members').select('ranch_id, markets_seen_at').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (error || !member) return null   // no membership, or migration 048 not applied yet
  const seen = (member as { markets_seen_at?: string | null }).markets_seen_at ?? null

  const db = createServiceClient()
  const [barnRes, natRes, lrpRes] = await Promise.all([
    localSlug ? db.from('mars_price_snapshots').select('slug_id, barn_name, report_date, ingested_at').eq('slug_id', localSlug).maybeSingle() : Promise.resolve({ data: null }),
    db.from('national_beef_snapshots').select('week_ending, ingested_at').order('week_ending', { ascending: false }).limit(1).maybeSingle(),
    db.from('lrp_price_snapshots').select('effective_date, created_at').order('effective_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  const barn = barnRes.data as { slug_id: string; barn_name: string; report_date: string; ingested_at: string } | null
  const nat = natRes.data as { week_ending: string; ingested_at: string } | null
  const lrp = lrpRes.data as { effective_date: string; created_at: string } | null
  const isNew = (ingestedAt: string | null | undefined) => !!ingestedAt && (!seen || ingestedAt > seen)

  const lines: string[] = []
  if (barn) {
    const town = BARN_GEO[barn.slug_id]?.town.replace(/,\s*[A-Z]{2}$/, '') ?? barn.barn_name
    lines.push(isNew(barn.ingested_at)
      ? `New ${town} report — ${DOW(barn.report_date)}, sale of ${day(barn.report_date)}${pinned ? ' (your pinned market)' : ''}`
      : `Your latest local reference is from ${DOW(barn.report_date)} (${day(barn.report_date)})`)
  }
  if (nat) lines.push(isNew(nat.ingested_at) ? `New national feeder summary — week ending ${day(nat.week_ending)}` : `No new national feeder summary since week ending ${day(nat.week_ending)}`)
  if (lrp) lines.push(isNew(lrp.created_at) ? `New LRP coverage prices — effective ${day(lrp.effective_date)}` : `LRP coverage prices unchanged since ${day(lrp.effective_date)}`)
  if (lines.length === 0) return <LastSeenPing surface="markets" />

  return (
    <Card shadow="soft" className="p-4 sm:p-5">
      <LastSeenPing surface="markets" />
      <p className={EYEBROW}>{seen ? 'Since you last checked' : 'Since yesterday'}</p>
      <ul className="mt-2 space-y-1.5">
        {lines.map(l => <li key={l} className="font-dm-sans text-[16px] leading-snug text-forest-green">{l}</li>)}
      </ul>
    </Card>
  )
}
