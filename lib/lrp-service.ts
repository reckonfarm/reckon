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

// The dashboard Markets card has always shown ONE type: Feeder Cattle · Steers Weight 2. The
// snapshot writer now seeds the full 4-type beef matrix (Steers/Heifers × Weight 1/2), so
// getLatestLrp must PIN to this type — otherwise its limit(1) across multiple types per
// effective_date would be non-deterministic and the card could silently switch types. Outlook
// reads the whole matrix via getLrpMatrix; the card stays on this pinned type, unchanged.
const DASHBOARD_LRP_TYPE = 'Steers Weight 2'

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

// One rung of the endorsement ladder surfaced for the sale-window picker. Same basis as
// the headline (100% coverage, adj 1.00) so the rungs are apples-to-apples with the hero.
// endorsement_end_date is kept as the snapshot's raw US 'MM/DD/YYYY' string — the card's
// fmtDate already parses that and derives the sale month from it.
export interface LrpLadderRung {
  endorsement_length_weeks: number
  coverage_price:           number
  producer_premium_per_cwt: number
  endorsement_end_date:     string   // raw 'MM/DD/YYYY'
}

export type LrpResult =
  | { status: 'ok'; lrp: LrpHeadline; ladder: LrpLadderRung[] }
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

// One snapshot.rows entry as the seed writes it (read defensively — everything unknown).
interface RawRow {
  endorsement_length_weeks?: unknown
  coverage_price?:           unknown
  producer_premium_per_cwt?: unknown
  endorsement_end_date?:     unknown
  coverage_level?:           unknown
  price_adj_factor?:         unknown
}

// Parse the snapshot's raw US 'MM/DD/YYYY' end date to epoch ms; null if unparseable, so a
// bad date DROPS the rung rather than NaN-sorting it.
function parseUsDateMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const ms = Date.parse(`${m[3]}-${m[1]}-${m[2]}T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

// Build the endorsement ladder from snapshot.rows: the SAME basis as the headline
// (100% coverage, adj 1.00), so the rungs are apples-to-apples with the hero. Drops any
// rung missing a finite price/length or a parseable end date; sorts by end date ascending.
// Returns [] when rows are absent or nothing qualifies — the card then degrades to the
// headline-only view. NEVER throws, NEVER fabricates: a bad row is omitted, not zeroed.
function buildLadder(snapshot: unknown): LrpLadderRung[] {
  const rows = (snapshot as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return []

  const rungs: Array<{ rung: LrpLadderRung; ms: number }> = []
  for (const raw of rows as RawRow[]) {
    if (!raw || typeof raw !== 'object') continue

    // 100% coverage only. We do NOT filter price_adj_factor — it's a per-TYPE property, not a
    // basis criterion; filtering 1.00 empties the ladder for non-base types (e.g. Heifers
    // Weight 2, adj 0.90). Steers Weight 2 is adj 1.00 throughout, so the dashboard ladder
    // (pinned to Steers Weight 2) is byte-identical with or without this filter.
    const level = finiteNum(raw.coverage_level)
    if (level === null || Math.abs(level - 1.0) > 1e-6) continue

    const price = finiteNum(raw.coverage_price)
    const len   = finiteNum(raw.endorsement_length_weeks)
    const ms    = parseUsDateMs(raw.endorsement_end_date)
    if (price === null || len === null || ms === null) continue

    rungs.push({
      rung: {
        endorsement_length_weeks: len,
        coverage_price:           price,
        producer_premium_per_cwt: finiteNum(raw.producer_premium_per_cwt) ?? 0,
        endorsement_end_date:     raw.endorsement_end_date as string,
      },
      ms,
    })
  }

  rungs.sort((a, b) => a.ms - b.ms)
  return rungs.map(r => r.rung)
}

// Build the LrpHeadline from a snapshot row (defensive — every field unknown until checked).
// Returns null on a bad payload (missing headline object or a non-finite coverage price) so the
// caller degrades to data_unavailable, never a NaN. `lrpTypeOverride` lets the matrix path key
// on the NORMALIZED lrp_type column ('Steers Weight 2'); the dashboard path omits it and keeps
// the raw report string (e.g. '810 Steers Weight 2') it has always displayed.
function headlineFromRow(row: SnapshotRow, lrpTypeOverride?: string): LrpHeadline | null {
  const head = (row.snapshot as { headline?: RawHeadline }).headline
  if (!head || typeof head !== 'object') return null

  const coveragePrice = finiteNum(head.coverage_price)
  if (coveragePrice === null) return null

  // Staleness from the real effective_date — never fabricate currency. No trustworthy date →
  // treat as stale rather than imply currency.
  let stale = true
  if (row.effective_date) {
    const ageDays = (Date.now() - Date.parse(`${row.effective_date}T00:00:00Z`)) / 86_400_000
    stale = ageDays > STALE_DAYS
  }

  return {
    commodity:                typeof head.commodity === 'string' ? head.commodity : '',
    lrp_type:                 lrpTypeOverride ?? (typeof head.type === 'string' ? head.type : ''),
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
}

export async function getLatestLrp(state: string = 'MT'): Promise<LrpResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('lrp_price_snapshots')
      .select('effective_date, as_of, source, snapshot')
      .eq('state', state)
      .eq('lrp_type', DASHBOARD_LRP_TYPE)   // PIN — the seed now writes 4 types; the card stays on this one
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[lrp] snapshot read failed:', error.message)
      return { status: 'data_unavailable' }
    }

    const row = data as SnapshotRow | null
    if (!row || !row.snapshot) return { status: 'none' }

    // Defensive headline parse — a missing headline / non-finite price is a bad payload, not a
    // fabricated number.
    const lrp = headlineFromRow(row)
    if (!lrp) {
      console.error('[lrp] snapshot headline unparseable — treating as unavailable')
      return { status: 'data_unavailable' }
    }

    // Surface the endorsement ladder for the sale-window picker. Built off the SAME snapshot we
    // just read; an unbuildable ladder is [] (card degrades to headline-only).
    const ladder = buildLadder(row.snapshot)

    return { status: 'ok', lrp, ladder }
  } catch (err) {
    console.error('[lrp] read threw:', err)
    return { status: 'data_unavailable' }
  }
}

// ─── Outlook matrix (per-lot read path) ───────────────────────────────────────────────────
// The per-lot Outlook reads the FULL 4-type beef matrix (Steers/Heifers × Weight 1/2), each
// type at its own most-recent effective_date with its own stale flag (the seed is residential/
// launchd; a type that didn't post stays at its last date and goes stale on its own). Build 2
// maps a lot → 'Steers Weight 2' via lotToLrpType and looks up its floor here; a missing or
// stale type degrades honestly in the panel (never a stale-as-current floor). Pure read; never
// throws — a query error → data_unavailable, nothing seeded → none.

export interface LrpTypeFloor {
  // `lrp.lrp_type` here is the NORMALIZED column value ('Steers Weight 2') — the lot→type join
  // key — NOT the raw report string (the dashboard path keeps the raw string).
  lrp:    LrpHeadline
  ladder: LrpLadderRung[]
}

export type LrpMatrixResult =
  | { status: 'ok'; floors: LrpTypeFloor[] }
  | { status: 'none' }
  | { status: 'data_unavailable' }

export async function getLrpMatrix(state: string = 'MT'): Promise<LrpMatrixResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('lrp_price_snapshots')
      .select('lrp_type, effective_date, as_of, source, snapshot')
      .eq('state', state)
      .order('effective_date', { ascending: false })

    if (error) {
      console.error('[lrp] matrix read failed:', error.message)
      return { status: 'data_unavailable' }
    }

    const rows = (data ?? []) as Array<SnapshotRow & { lrp_type: string }>
    if (rows.length === 0) return { status: 'none' }

    // Newest effective_date per lrp_type (rows are date-desc → first seen per type wins).
    const seen = new Set<string>()
    const floors: LrpTypeFloor[] = []
    for (const row of rows) {
      if (!row.lrp_type || seen.has(row.lrp_type) || !row.snapshot) continue
      const lrp = headlineFromRow(row, row.lrp_type)   // normalize the join key to the column
      if (!lrp) continue                                // bad payload for this type — skip it
      seen.add(row.lrp_type)
      floors.push({ lrp, ladder: buildLadder(row.snapshot) })
    }

    if (floors.length === 0) return { status: 'data_unavailable' }
    return { status: 'ok', floors }
  } catch (err) {
    console.error('[lrp] matrix read threw:', err)
    return { status: 'data_unavailable' }
  }
}
