import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { getOperationProfile } from '@/lib/operation-profile-service'
import { getUpcomingDeadlines } from '@/lib/rma-deadline-service'
import { buildProgramAlerts, cropsToStringArray, readDismissals, type DatedReading } from '@/lib/program-alerts'
import ProgramAlerts from './ProgramAlerts'

// ─── Change-only program alerts, streamed (Block A) ──────────────────────────
// Block 7.9's alerts — the drought reading moved, the LFP tier moved, a
// deadline came close — used to be computed in the shell's head, which meant
// the drought rows, the weekly LFP snapshots, the operation profile (for its
// crops), the deadlines and the dismissals were all read before Today's first
// byte. None of them is the ranch's own record. They are read here, inside the
// boundary the shell puts around this component, and the stack above paints
// without them. Nothing to say renders nothing, as before.
export default async function ProgramAlertsAsync({ countyId, fips, countyName, userId }: {
  countyId: number; fips: string; countyName: string; userId: string
}) {
  const alerts = await read(countyId, fips, countyName, userId).catch(() => null)
  if (!alerts) return null
  return <ProgramAlerts alerts={alerts} />
}

async function read(countyId: number, fips: string, countyName: string, userId: string) {
  const supabase = await createClient()
  const db = createServiceClient()
  const [{ data: readings }, { data: tiers }, profileResult] = await Promise.all([
    db.from('drought_data').select('week_date, d0, d1, d2, d3, d4').eq('county_id', countyId).order('week_date', { ascending: false }).limit(2),
    db.from('lfp_eligibility_snapshots').select('week_date, max_tier').eq('county_id', countyId).order('week_date', { ascending: false }).limit(2),
    getOperationProfile({ supabase, user: { id: userId } }),
  ])
  const crops = profileResult.status === 'ok' ? cropsToStringArray(profileResult.profile.crops) : null
  const [deadlines, seen] = await Promise.all([getUpcomingDeadlines(fips, crops), readDismissals(supabase, userId)])
  const r = (readings ?? []) as DatedReading[]
  const t = (tiers ?? []) as { week_date: string; max_tier: number }[]
  const all = buildProgramAlerts({
    fips,
    countyName,
    latest: r[0] ?? null,
    prior: r[1] ?? null,
    lfpTier: t[0]?.max_tier ?? null,
    priorLfpTier: t[1]?.max_tier ?? null,
    deadlines,
  })
  return all.filter(a => !seen.has(a.key))
}
