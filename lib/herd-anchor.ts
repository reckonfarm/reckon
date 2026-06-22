import 'server-only'
import type { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { resolveBarns } from '@/lib/barn-resolver'
import { estimateHerd, type HerdEstimate } from '@/lib/herd-estimate'
import { buildTrend, type TrendData, type HerdHistoryRow, type PriceHistoryRow } from '@/lib/trend'
import { getLrpMatrix } from '@/lib/lrp-service'
import { buildOutlook, type OutlookData } from '@/lib/outlook'
import type { Lot } from '@/lib/herd'

// The user-scoped SSR supabase client (lib/supabase-server createClient). Passed IN so the
// caller owns the auth context — the herd_estimate_history read must stay RLS-scoped to the
// owner, so the helper never mints its own client.
type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

export interface HerdAnchor {
  estimate: HerdEstimate
  trend: TrendData | null
  outlook: OutlookData | null
}

// Orchestrates the herd-value anchor — this week's HerdEstimate (cash) + Trend + Outlook —
// from already-resolved inputs. Extracted verbatim from app/herd/page.tsx so /herd and the
// dashboard can share one path; no behavior change. The caller resolves homeFips and passes
// the user-scoped supabase client (RLS). createServiceClient (service-role, no auth context)
// for the price-history read is fine here. Trend/Outlook degrade to null; the estimate does not.
export async function getHerdAnchor(input: {
  lots: Lot[]
  homeFips: string
  supabase: ServerSupabaseClient
}): Promise<HerdAnchor> {
  const { lots, homeFips, supabase } = input

  const resolved = await resolveBarns(homeFips)
  const estimate = estimateHerd({ lots }, resolved)

  // Trend reads (additive — degrade honestly; never block the estimate above). Herd history
  // via the user-scoped SSR client so the owner-SELECT RLS scopes to the caller; price
  // history via service-role (RLS-none). A read error → null → the panel shows "unavailable".
  let herdHistory: HerdHistoryRow[] | null = null
  try {
    const { data, error } = await supabase
      .from('herd_estimate_history')
      .select('snapshot_date, total_value, lots_priced')
      .order('snapshot_date', { ascending: false })
      .limit(2)
    herdHistory = error ? null : ((data ?? []) as HerdHistoryRow[])
  } catch { herdHistory = null }

  let priceHistory: PriceHistoryRow[] | null = []
  const localSlugs = resolved.local.map(b => b.slug_id)
  if (localSlugs.length > 0) {
    try {
      const { data, error } = await createServiceClient()
        .from('mars_price_history')
        .select('slug_id, report_date, rows')
        .in('slug_id', localSlugs)
        .order('report_date', { ascending: false })
      priceHistory = error ? null : ((data ?? []) as PriceHistoryRow[])
    } catch { priceHistory = null }
  }

  const trend = buildTrend({ resolved, estimate, lots, herdHistory, priceHistory })

  // Outlook (additive — degrade honestly; never block estimate/trend). Feeder LRP coverage
  // price is the national CME index, so the MT seed carries the national floor (state-
  // agnostic for feeder). getLrpMatrix never throws; buildOutlook is pure.
  const matrix = await getLrpMatrix('MT')
  const outlook = buildOutlook({ lots, matrix })

  return { estimate, trend, outlook }
}
