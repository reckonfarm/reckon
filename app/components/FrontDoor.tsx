import Link from 'next/link'
import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import SiteFooter from '@/app/components/SiteFooter'
import CountySearch from '@/app/components/CountySearch'
import MarketsComingSoon from '@/app/components/MarketsComingSoon'
import { Card } from '@/app/components/ui/Card'
import { resolveBarns } from '@/lib/barn-resolver'
import { estimateHerd, type HerdEstimate } from '@/lib/herd-estimate'
import type { Lot } from '@/lib/herd'

// ─── Front door — the signed-out homepage (the acquisition front door) ───────────────────────
// The Apple-restraint redesign of the Markets surface — the signed-out front door, rendered at
// both / and /markets-preview. (Replaced the prior MarketsHome funnel.)
//
// THE HOOK is UNIVERSAL + NO-SIGNUP: the county dashboard is already public, so the CountySearch
// (hero action) → /dashboard?fips=X gives any visitor their drought status + estimated FSA/LFP
// payment + LRP price floor, free. THE PAYOFF is the HerdEstimate, shown as ONE clearly-labeled
// Example herd valued at this week's REAL Billings auction prices (never fabricated, never implied
// as theirs) → "sign up to value your own herd." Auction pricing is MT-now/expanding; the example
// is the honest demonstration of it.
//
// Every server query degrades to empty/honest and NEVER throws.

interface DriestChip { name: string; state: string; fips: string; tier: number }

async function getDriestChips(limit: number, stateFilter?: string): Promise<DriestChip[]> {
  try {
    const db = createServiceClient()
    const { data: weekRow } = await db
      .from('drought_data').select('week_date').order('week_date', { ascending: false }).limit(1).single()
    if (!weekRow) return []

    let query = db
      .from('drought_data')
      .select('d1, d2, d3, d4, counties!inner(fips, name, state)')
      .eq('week_date', weekRow.week_date)
      .gt('d1', 0)
    if (stateFilter) query = query.eq('counties.state', stateFilter)

    const { data } = await query
      .order('d4', { ascending: false }).order('d3', { ascending: false })
      .order('d2', { ascending: false }).order('d1', { ascending: false })
      .limit(limit)
    if (!data) return []

    return data
      .map(row => {
        const c = row.counties as unknown as { fips: string; name: string; state: string } | null
        const d4 = row.d4 ?? 0, d3 = row.d3 ?? 0, d2 = row.d2 ?? 0
        const tier = d4 > 0 ? 4 : d3 > 0 ? 3 : d2 > 0 ? 2 : 1
        return { name: c?.name ?? 'Unknown', state: c?.state ?? '', fips: c?.fips ?? '', tier }
      })
      .filter(c => c.fips)
  } catch {
    return []
  }
}

// Example herd — a sample MT herd valued at this week's REAL Billings auction prices, labeled
// "Example", NEVER implied as the visitor's. Yellowstone County (Billings) = 30111. A single
// clean lot keeps the payoff restrained; honest degradation: no fresh prices → no number.
const EXAMPLE_FIPS = '30111'
const EXAMPLE_LOTS: Lot[] = [{
  id: 'example-steers',
  class: 'steers',
  head_count: 300,
  avg_weight: 550,
  weight_unit: 'lb',
  frame: 'Medium and Large',
  weaned: true,
  sale_windows: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}]

async function getExampleEstimate(): Promise<HerdEstimate | null> {
  try {
    const resolved = await resolveBarns(EXAMPLE_FIPS)
    return estimateHerd({ lots: EXAMPLE_LOTS }, resolved)
  } catch {
    return null
  }
}

function formatUSD(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}
function fmtShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const CHIP_LIMIT = 4

const TIER_DOT = (tier: number) =>
  tier === 4 ? '#7B2D00' : tier === 3 ? '#C2410C' : tier === 2 ? '#D97706' : tier === 1 ? '#92400E' : '#78716C'

export default async function FrontDoor({ fips }: { fips?: string | null }) {
  // `fips` is retained in the signature/callers intentionally — Block 2 rebuilds this page and
  // decides its fate. No homepage consumer remains after the News section was removed (Block 1).
  void fips

  // Sign-in only drives the demand tiles; never throws, never redirects.
  let signedIn = false
  try {
    const supabase = await createClient()
    signedIn = Boolean((await supabase.auth.getUser()).data.user)
  } catch {
    signedIn = false
  }

  const headersList = await headers()
  const visitorRegion = headersList.get('x-vercel-ip-country-region') ?? ''
  const visitorState = visitorRegion.length === 2 ? visitorRegion : ''

  const [driestChipsLocal, driestChipsNational, example] = await Promise.all([
    visitorState ? getDriestChips(CHIP_LIMIT, visitorState) : Promise.resolve([]),
    getDriestChips(CHIP_LIMIT),
    getExampleEstimate(),
  ])
  const driestChips = driestChipsLocal.length >= 2 ? driestChipsLocal : driestChipsNational
  const chipsLabel =
    driestChipsLocal.length >= 2 && visitorState ? `Driest counties in ${visitorState} right now` : 'Driest counties right now'

  const examplePriced = example != null && example.lots_priced > 0
  const exampleTown = example?.perLot.find(l => l.source)?.source?.town.replace(/,\s*[A-Z]{2}$/, '') ?? 'Billings'

  return (
    <>
      <link rel="preconnect" href="https://a.tile.openstreetmap.org" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://b.tile.openstreetmap.org" crossOrigin="anonymous" />
      <SiteHeader />
      <main className="min-h-screen bg-cream">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:py-24">

          {/* ── Hero — the bold Fraunces line + quiet sub + the county action ─────────── */}
          <section className="text-center">
            <h1 className="font-fraunces text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
              Know what the drought owes you.
            </h1>
            <p className="mx-auto mt-5 max-w-xl font-dm-sans text-base leading-relaxed text-muted/70 sm:text-lg">
              Type your county for this week&rsquo;s drought status, your estimated FSA drought payment,
              and a price floor for your cattle. Free, no account needed.
            </p>

            <div className="mx-auto mt-8 max-w-md text-left">
              <CountySearch />
              <p className="mt-2 text-center font-dm-sans text-xs text-forest-green/40">
                Drought · estimated FSA/LFP payment · LRP price floor — for any U.S. county
              </p>
            </div>

            {driestChips.length > 0 && (
              <div className="mx-auto mt-6 flex max-w-md flex-wrap items-center justify-center gap-2">
                <p className="w-full font-dm-sans text-xs text-forest-green/40">{chipsLabel}</p>
                {driestChips.map(c => (
                  <Link
                    key={c.fips}
                    href={`/dashboard?fips=${c.fips}&view=drought`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-forest-green/15 bg-white px-3 py-1 font-dm-sans text-xs text-forest-green/70 transition-colors hover:border-forest-green/30 hover:text-forest-green"
                  >
                    <span className="inline-block flex-shrink-0 rounded-full" style={{ width: 8, height: 8, background: TIER_DOT(c.tier) }} />
                    {c.name}, {c.state}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* ── The payoff — ONE labeled Example HerdEstimate (real Billings prices) ─────── */}
          <section className="mt-20">
            <Card shadow="sm" className="p-6 sm:p-8">
              <p className="font-dm-sans text-xs font-semibold uppercase tracking-wider text-rust/70">Example</p>

              {examplePriced ? (
                <>
                  <p className="mt-2 font-fraunces text-4xl font-semibold leading-none tracking-tight text-ink tabular-nums sm:text-5xl">
                    {formatUSD(example!.total_priced)}
                  </p>
                  <p className="mt-2 font-dm-sans text-sm text-muted/70">
                    300 head · 550&nbsp;lb steers · valued at this week&rsquo;s {exampleTown} auction
                    {example!.as_of ? ` · as of ${fmtShort(example!.as_of)}` : ''}
                  </p>
                </>
              ) : (
                <p className="mt-2 font-fraunces text-2xl font-semibold tracking-tight text-ink/80 sm:text-3xl">
                  Your herd, valued at this week&rsquo;s auction
                </p>
              )}

              {/* Glimpse of the three directions (static echo of the real Now/Trend/Outlook toggle) */}
              <div className="mt-5 inline-flex rounded-lg border border-forest-green/15 bg-cream p-0.5 font-dm-sans text-xs">
                <span className="rounded-md bg-white px-3 py-1 font-medium text-forest-green shadow-sm">Now</span>
                <span className="px-3 py-1 text-forest-green/50">Trend</span>
                <span className="px-3 py-1 text-forest-green/50">Outlook</span>
              </div>
              <p className="mt-3 max-w-md font-dm-sans text-sm leading-relaxed text-muted/70">
                <span className="font-medium text-ink">Now</span>{' '}values your herd at this week&rsquo;s nearest auction.{' '}
                <span className="font-medium text-ink">Trend</span>{' '}tracks week-over-week.{' '}
                <span className="font-medium text-ink">Outlook</span>{' '}shows an LRP price floor per lot.
              </p>

              <p className="mt-4 font-dm-sans text-xs leading-relaxed text-muted/55">
                Example only — a sample herd on real auction prices, not a real operation. Live auction pricing
                is in Montana today and expanding.
              </p>

              <Link
                href="/signin"
                className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-forest-green px-6 font-dm-sans text-sm font-semibold text-cream transition-colors hover:bg-forest-green/90"
              >
                Sign up to value your herd →
              </Link>
            </Card>
          </section>

          <div className="mt-16">
            <MarketsComingSoon signedIn={signedIn} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
