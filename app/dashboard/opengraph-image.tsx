import { ImageResponse } from 'next/og'
import { createServiceClient } from '@/lib/supabase'
import { warning } from '@/lib/brand-colors'

export const alt = 'County drought and LFP status'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image({
  searchParams,
}: {
  searchParams: Promise<{ fips?: string }>
}) {
  const { fips } = await searchParams

  const FOREST_GREEN = '#1B4332'
  const CREAM = '#FDFBF7'
  // Triggered-state background uses the semantic "warning" role (lib/brand-colors),
  // not brand rust. FOREST_GREEN/CREAM here are deferred to the later hex consolidation.

  if (!fips) {
    return new ImageResponse(
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: FOREST_GREEN,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: CREAM, fontSize: '48px', fontWeight: 700 }}>Dryline</span>
      </div>
    )
  }

  const db = createServiceClient()
  const { data: county } = await db
    .from('counties')
    .select('name, state, fips')
    .eq('fips', fips)
    .single()

  if (!county) {
    return new ImageResponse(
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: FOREST_GREEN,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: CREAM, fontSize: '48px', fontWeight: 700 }}>Dryline</span>
      </div>
    )
  }

  // Get county_id first
  const { data: countyWithId } = await db
    .from('counties')
    .select('id')
    .eq('fips', fips)
    .single()

  let dLevel: number | null = null
  let payLabel: string | null = null
  let enforcement: string | null = null   // LFP FSA-enforcement state; null until the engine runs (D2+)

  if (countyWithId) {
    // Get most recent drought row
    const { data: droughtRow } = await db
      .from('drought_data')
      .select('d0, d1, d2, d3, d4')
      .eq('county_id', countyWithId.id)
      .order('week_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (droughtRow) {
      // Highest active drought level (d4 > 0 = D4, etc.)
      if (droughtRow.d4 > 0) dLevel = 4
      else if (droughtRow.d3 > 0) dLevel = 3
      else if (droughtRow.d2 > 0) dLevel = 2
      else if (droughtRow.d1 > 0) dLevel = 1
      else if (droughtRow.d0 > 0) dLevel = 0
    }

    // LFP payment estimate — SAME audited estimator + default grazing window as the dashboard.
    if (dLevel !== null && dLevel >= 2) {
      const { computeLfpEligibility } = await import('@/lib/lfp-eligibility')
      const { estimatePayment } = await import('@/lib/lfp-payment')
      const { resolveDefaultGrazingWindow } = await import('@/lib/grazing-window')
      const lfp = await computeLfpEligibility(fips, { grazingPeriod: resolveDefaultGrazingWindow(fips) })
      enforcement = lfp?.enforcement ?? null
      // The dollar travels in the link preview ONLY for officially-eligible counties. A
      // pending_obbba county meets the OBBBA D2 threshold but FSA hasn't loaded it into the
      // 2026 maps, so no payment figure is shown — same gate as every dashboard surface.
      if (lfp && lfp.enforcement === 'officially_eligible' && lfp.payments > 0) {
        // County-level / 100-head-beef reference figure — matches the dashboard banner. Never personalized.
        const est = estimatePayment('beef_adult', 100, lfp.payments).cappedEstimate
        payLabel = `$${Math.round(est).toLocaleString()}`
      }
    }
  }

  const official = enforcement === 'officially_eligible'
  const pending  = enforcement === 'pending_obbba'
  const dLabel = dLevel !== null ? `D${dLevel}` : 'No data'

  // Pending badge tone — matches the dashboard's amber pending banner (amber-100 bg /
  // amber-800 text); distinct from the alarming `warning` orange used for official triggers.
  const AMBER_BG   = '#FEF3C7'
  const AMBER_TEXT = '#92400E'

  return new ImageResponse(
    <div
      style={{
        width: '1200px',
        height: '630px',
        background: FOREST_GREEN,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
      }}
    >
      <span style={{ color: CREAM, fontSize: '28px', fontWeight: 400, opacity: 0.6 }}>
        Dryline · Drought & LFP Intelligence
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <span style={{ color: CREAM, fontSize: '72px', fontWeight: 700, lineHeight: 1.1 }}>
          {county.name}, {county.state}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '8px' }}>
          <span
            style={{
              background: official ? warning : pending ? AMBER_BG : CREAM,
              color: official ? CREAM : pending ? AMBER_TEXT : FOREST_GREEN,
              fontSize: '32px',
              fontWeight: 700,
              padding: '10px 24px',
              borderRadius: '8px',
            }}
          >
            {dLabel}
          </span>
          {official && payLabel && (
            <span style={{ color: CREAM, fontSize: '40px', fontWeight: 700 }}>
              {payLabel} est. payment
            </span>
          )}
          {pending && (
            <span style={{ color: CREAM, fontSize: '32px', fontWeight: 700 }}>
              Meets new OBBBA D2 threshold — pending FSA
            </span>
          )}
          {!official && !pending && (
            <span style={{ color: CREAM, fontSize: '32px', fontWeight: 400, opacity: 0.7 }}>
              Not triggered
            </span>
          )}
        </div>
      </div>

      <span style={{ color: CREAM, fontSize: '24px', opacity: 0.5 }}>
        dryline.farm
      </span>
    </div>
  )
}
