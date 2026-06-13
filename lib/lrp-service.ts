import 'server-only'

import { createServiceClient } from './supabase'

// ─── LRP price service (read path) ───────────────────────────────────────────────
//
// Reads public.lrp_price_snapshots (migration 022) for the dashboard's Markets card.
// PUBLIC reference data (RLS-on-with-no-policies), so it reads with the SERVICE-ROLE
// client — NOT the SSR/anon client. (Same posture as lib/cattle-market-service.ts and
// lib/rma-deadline-service.ts; the OPPOSITE of operation-profile, which is user-owned.)
//
// The RMA LRP report is fetched + parsed OFF the request path by scripts/lrp-snapshot.ts
// (a local seed; RMA is a 3-step antiforgery POST wizard and may block datacenter
// egress), which upserts a headline snapshot. This module just READS the most recent
// snapshot — a fast Supabase SELECT that works fine from Vercel.
//
// HONEST RESULT (mirrors getCattleMarket — discriminated, never fabricate):
//   • fresh snapshot      → { status: 'ok', lrp } with stale=false + real effective_date.
//   • stale snapshot      → { status: 'ok', lrp } with stale=TRUE (a daily post was
//                           missed); STILL shown, but the card labels it with its real
//                           effective_date, never "current".
//   • no snapshot at all  → { status: 'none' } (genuine absence — nothing seeded yet).
//   • query error / bad payload → { status: 'data_unavailable' } (honest, never a NaN).

// A snapshot older than this (by effective_date) means a daily business-day post was
// missed — show it, but clearly flagged stale. LRP coverage prices post each business
// day, so ~7 days tolerates a normal weekend/holiday gap before we call it stale.
const STALE_DAYS = 7

export interface LrpHeadline {
  commodity:                string
  lrp_type:                 string
  coverage_price:           number
  expected_ending_value:    number
  coverage_level:           number
  endorsement_length_weeks: number
  producer_premium_per_cwt: number
  endorsement_end_date:     string | null
  effective_date:           string   // ISO 'YYYY-MM-DD'
  as_of:                    string | null
  source:                   string
  stale:                    boolean
}

export type LrpResult =
  | { status: 'ok'; lrp: LrpHeadline }
  | { status: 'none' }
  | { status: 'data_unavailable' }

interface SnapshotRow {
  effective_date: string
  as_of:          string | null
  source:         string | null
  snapshot:       unknown
}

// Shape of the headline object the seed writes into snapshot.headline. Read defensively.
interface RawHeadline {
  commodity?:                unknown
  type?:                     unknown
  coverage_price?:           unknown
  expected_ending_value?:    unknown
  coverage_level?:           unknown
  endorsement_length_weeks?: unknown
  producer_premium_per_cwt?: unknown
  endorsement_end_date?:     unknown
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function getLatestLrp(state: string = 'MT'): Promise<LrpResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('lrp_price_snapshots')
      .select('effective_date, as_of, source, snapshot')
      .eq('state', state)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[lrp] snapshot read failed:', error.message)
      return { status: 'data_unavailable' }
    }

    const row = data as SnapshotRow | null
    if (!row || !row.snapshot) return { status: 'none' }

    // Pull the headline out of the jsonb defensively — a missing headline or a
    // non-finite coverage price is a bad payload, NOT a fabricated number.
    const head = (row.snapshot as { headline?: RawHeadline }).headline
    if (!head || typeof head !== 'object') {
      console.error('[lrp] snapshot missing headline — treating as unavailable')
      return { status: 'data_unavailable' }
    }

    const coveragePrice = finiteNum(head.coverage_price)
    if (coveragePrice === null) {
      console.error('[lrp] headline coverage_price is not a finite number — unavailable')
      return { status: 'data_unavailable' }
    }

    // Staleness from the real effective_date — never fabricate currency.
    let stale = false
    if (row.effective_date) {
      const ageDays = (Date.now() - Date.parse(`${row.effective_date}T00:00:00Z`)) / 86_400_000
      stale = ageDays > STALE_DAYS
    } else {
      stale = true   // no trustworthy date → treat as stale rather than imply currency
    }

    const lrp: LrpHeadline = {
      commodity:                typeof head.commodity === 'string' ? head.commodity : '',
      lrp_type:                 typeof head.type === 'string' ? head.type : '',
      coverage_price:           coveragePrice,
      expected_ending_value:    finiteNum(head.expected_ending_value) ?? coveragePrice,
      coverage_level:           finiteNum(head.coverage_level) ?? 0,
      endorsement_length_weeks: finiteNum(head.endorsement_length_weeks) ?? 0,
      producer_premium_per_cwt: finiteNum(head.producer_premium_per_cwt) ?? 0,
      endorsement_end_date:     typeof head.endorsement_end_date === 'string' ? head.endorsement_end_date : null,
      effective_date:           row.effective_date,
      as_of:                    row.as_of,
      source:                   row.source ?? 'USDA RMA',
      stale,
    }

    return { status: 'ok', lrp }
  } catch (err) {
    console.error('[lrp] read threw:', err)
    return { status: 'data_unavailable' }
  }
}
