import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'
import { Heading } from '@/app/components/ui/Heading'
import { Card } from '@/app/components/ui/Card'
import HerdForm from './HerdForm'
import HerdEstimatePanel from './HerdEstimatePanel'
import { getOperationProfile } from '@/lib/operation-profile-service'
import { resolveBarns } from '@/lib/barn-resolver'
import { estimateHerd, type HerdEstimate } from '@/lib/herd-estimate'
import { buildTrend, type TrendData, type HerdHistoryRow, type PriceHistoryRow } from '@/lib/trend'
import { getLrpMatrix } from '@/lib/lrp-service'
import { buildOutlook, type OutlookData } from '@/lib/outlook'
import type { Lot } from '@/lib/herd'

// Private, operation-scoped herd page. Auth-gated like /profile. Shows the HerdEstimate
// (herd valued at this week's nearest auction cash) ABOVE the capture form. The form is
// untouched — additive. The HerdEstimate is server-computed; after a lot edit the form calls
// router.refresh() so this re-renders. County comes from profiles.home_county_fips (the
// actively-set home county), NOT operation_profiles.county_fips (no UI sets that one).
export default async function HerdPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  // HerdEstimate inputs — degrade honestly; never block the capture form below.
  const profileResult = await getOperationProfile()
  const herd = profileResult.status === 'ok' ? (profileResult.profile.herd as { lots?: Lot[] } | null) : null
  const lots = Array.isArray(herd?.lots) ? herd!.lots : []

  let estimate: HerdEstimate | null = null
  let trend: TrendData | null = null
  let outlook: OutlookData | null = null
  let homeCountyMissing = false
  if (lots.length > 0) {
    const { data: prof } = await createServiceClient()
      .from('profiles')
      .select('home_county_fips')
      .eq('id', user.id)
      .maybeSingle()
    const homeFips = (prof as { home_county_fips: string | null } | null)?.home_county_fips ?? null
    if (homeFips) {
      const resolved = await resolveBarns(homeFips)
      estimate = estimateHerd({ lots }, resolved)

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

      trend = buildTrend({ resolved, estimate, lots, herdHistory, priceHistory })

      // Outlook (additive — degrade honestly; never block estimate/trend). Feeder LRP coverage
      // price is the national CME index, so the MT seed carries the national floor (state-
      // agnostic for feeder). getLrpMatrix never throws; buildOutlook is pure.
      const matrix = await getLrpMatrix('MT')
      outlook = buildOutlook({ lots, matrix })
    } else {
      homeCountyMissing = true
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Heading level={2}>My herd</Heading>
        <p className="mt-1 font-dm-sans text-sm text-muted/70">
          What you&rsquo;re running, by lot — and what it&rsquo;s worth at this week&rsquo;s cash.
        </p>

        {/* HerdEstimate (additive — the capture form below is unchanged) */}
        {estimate && (
          <div className="mt-8">
            <HerdEstimatePanel estimate={estimate} trend={trend} outlook={outlook} />
          </div>
        )}

        {homeCountyMissing && (
          <Card shadow="sm" className="mt-8 p-5">
            <p className="font-dm-sans text-sm font-semibold text-ink">Set your home county to value your herd</p>
            <p className="mt-1 font-dm-sans text-sm text-muted/70">
              Your HerdEstimate uses the nearest cattle auction to your operation.{' '}
              <Link href="/dashboard" className="text-accent underline hover:text-accent/80">Set your home county</Link>{' '}
              and it&rsquo;ll show up here.
            </p>
          </Card>
        )}

        {lots.length === 0 && (
          <p className="mt-8 font-dm-sans text-sm text-muted/60">
            Add a lot below and your <span className="font-medium text-ink">HerdEstimate</span> appears here —
            your herd valued at this week&rsquo;s nearest auction cash.
          </p>
        )}

        {/* Lots — the capture form (unchanged) */}
        <div className="mt-10">
          <HerdForm />
        </div>
      </main>
    </>
  )
}
