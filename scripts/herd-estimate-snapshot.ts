import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { rankFreshBarns, type BarnSnapshot, type ResolveResult } from '../lib/barn-geo'
import { estimateHerd } from '../lib/herd-estimate'
import type { Lot } from '../lib/herd'

// ─── HerdEstimate history capture (the data moat) ────────────────────────────────────────
// Daily per-user snapshot of total herd value, SERVER-AUTHORITATIVE, appended to
// herd_estimate_history (migration 026; owner-scoped read, cron-only write). Runs as the SECOND
// step of mars-snapshot.yml, AFTER the price refresh, so it values off fresh prices.
//
// Mirrors lib/lfp-snapshot.ts (service-role, iterate the set, append) but runs as a standalone
// tsx step like scripts/mars-snapshot.ts — so it makes its OWN guarded client and uses the
// DB-FREE pure rankFreshBarns + estimateHerd, NOT resolveBarns (which imports lib/supabase —
// unavailable here: Actions has no NEXT_PUBLIC env, Node has no global WebSocket). Reads are
// HOISTED to bulk (barns once; profiles/counties chunked), so the per-user work is pure +
// in-memory — no per-item network, hence no concurrency throttle is needed (unlike lfp's
// per-county USDM calls). A ranch with no USABLE total (every priced lot thin, or none
// priced) records NO ROW for that day — zero is the absence of a valuation, not a
// valuation of zero, and total_value is NOT NULL so a gap is the only honest shape —
// never skips a herd it could place, never fakes $0-worth. NEVER fails the price step (the
// workflow runs this with continue-on-error).

const CHUNK = 1000 // stay under Supabase's default .in()/upsert caps (as lib/lfp-snapshot does)

// Own guarded service client (mirrors scripts/mars-snapshot.ts). Reads SUPABASE_URL ||
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the workflow supplies SUPABASE_URL +
// the service key). NoopWebSocket so supabase-js never instantiates a realtime transport
// (throws on Node ≤20); we only do REST reads/writes.
async function makeClient() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in herd-estimate-snapshot') } }
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })
}

function extractLots(herd: unknown): Lot[] {
  const lots = (herd as { lots?: unknown } | null)?.lots
  return Array.isArray(lots) ? (lots as Lot[]) : []
}

async function main() {
  const db = await makeClient()
  const snapshotDate = new Date().toISOString().slice(0, 10) // server (UTC) capture date

  // 1) Barns — read ONCE (shared across all users).
  const { data: barnRows, error: barnErr } = await db
    .from('mars_price_snapshots')
    .select('slug_id, barn_name, city, state, report_date, row_count, rows')
  if (barnErr) { console.error('[herd-estimate-snapshot] barns read failed:', barnErr.message); process.exit(1) }
  const barns = (barnRows ?? []) as BarnSnapshot[]

  // 2) RANCHES with a herd (Block 4A / 050: one profile row per ranch; the service role
  //    sees all of them). A row with no ranch (a person on no ranch) is skipped — there
  //    is no ranch to record a value for.
  // Block 4B: the herd is herd_lots rows (live = not retired), grouped by ranch. The
  // profile row still supplies who last wrote for the ranch (placement fallback).
  const { data: lotRows, error: lotErr } = await db
    .from('herd_lots')
    .select('id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, created_at, updated_at')
    .is('retired_at', null)
  if (lotErr) { console.error('[herd-estimate-snapshot] herd_lots read failed:', lotErr.message); process.exit(1) }
  const { data: opRows, error: opErr } = await db.from('operation_profiles').select('user_id, ranch_id').not('ranch_id', 'is', null)
  if (opErr) { console.error('[herd-estimate-snapshot] operation_profiles read failed:', opErr.message); process.exit(1) }
  const { data: ranchRows } = await db.from('ranches').select('id, home_county_fips')
  const ranchHome = new Map((ranchRows ?? []).map(r => [(r as { id: string }).id, (r as { home_county_fips?: string | null }).home_county_fips ?? null]))
  const writerByRanch = new Map((opRows ?? []).map(r => [(r as { ranch_id: string }).ranch_id, (r as { user_id: string }).user_id]))
  // history.user_id is NOT NULL: the writer of the ranch's profile row, else the ranch's first owner.
  const { data: owners } = await db.from('ranch_members').select('ranch_id, user_id, role, created_at').eq('role', 'owner').order('created_at', { ascending: true })
  const ownerByRanch = new Map<string, string>()
  for (const o of owners ?? []) { const rid = (o as { ranch_id: string }).ranch_id; if (!ownerByRanch.has(rid)) ownerByRanch.set(rid, (o as { user_id: string }).user_id) }
  const byRanch = new Map<string, Record<string, unknown>[]>()
  for (const r of lotRows ?? []) { const rid = (r as { ranch_id: string }).ranch_id; byRanch.set(rid, [...(byRanch.get(rid) ?? []), r as Record<string, unknown>]) }
  const users = [...byRanch.entries()]
    .map(([ranch_id, rows]) => ({ ranch_id, user_id: writerByRanch.get(ranch_id) ?? ownerByRanch.get(ranch_id) ?? '', lots: extractLots({ lots: rows.map(r => ({ ...r, avg_weight: Number(r.avg_weight), name: r.name ?? undefined })) }) }))
    .filter(u => u.lots.length > 0 && u.user_id)

  if (users.length === 0) { console.log('[herd-estimate-snapshot] no ranch herds with lots — nothing to do.'); return }

  // 3) Home county per ranch. Home county is still PER PERSON (profiles.home_county_fips);
  //    until a ranch-level home county exists (PK's call, Block 4), the ranch is placed by
  //    the county of the member who last wrote its herd (user_id on the row).
  const homeByUser = new Map<string, string>()
  const ids = [...new Set(users.map(u => u.user_id).filter(Boolean))]
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from('profiles').select('id, home_county_fips').in('id', ids.slice(i, i + CHUNK))
    if (error) { console.error('[herd-estimate-snapshot] profiles read failed:', error.message); process.exit(1) }
    for (const p of data ?? []) {
      const fips = (p as { home_county_fips: string | null }).home_county_fips
      if (fips) homeByUser.set((p as { id: string }).id, fips)
    }
  }

  const fipsList = [...new Set(homeByUser.values())]
  const centroidByFips = new Map<string, { name: string | null; lat: number; lon: number }>()
  for (let i = 0; i < fipsList.length; i += CHUNK) {
    const { data, error } = await db.from('counties').select('fips, name, lat, lon').in('fips', fipsList.slice(i, i + CHUNK))
    if (error) { console.error('[herd-estimate-snapshot] counties read failed:', error.message); process.exit(1) }
    for (const c of data ?? []) {
      const row = c as { fips: string; name: string | null; lat: number | string | null; lon: number | string | null }
      const lat = row.lat == null ? null : Number(row.lat)
      const lon = row.lon == null ? null : Number(row.lon)
      if (lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon)) {
        centroidByFips.set(row.fips, { name: row.name, lat, lon })
      }
    }
  }

  // 4) Per user — PURE rank + estimate (no I/O). Skip users with no home county / centroid (can't
  //    value against a barn). Honest records (incl. unpriced) for everyone we CAN place.
  const now = Date.now()
  const rows: Array<Record<string, unknown>> = []
  let skipped = 0
  let unvalued = 0
  for (const u of users) {
    // 052: the ranch's own home county first; the writer's county until it is set.
    const fips = ranchHome.get(u.ranch_id) ?? homeByUser.get(u.user_id)
    const c = fips ? centroidByFips.get(fips) : undefined
    if (!fips || !c) { skipped++; continue }
    const resolved: ResolveResult = {
      county_fips: fips, county_name: c.name, centroid: { lat: c.lat, lon: c.lon },
      ...rankFreshBarns({ lat: c.lat, lon: c.lon }, barns, now),
    }
    const est = estimateHerd({ lots: u.lots }, resolved)
    // ── A DAY WITH NO USABLE VALUATION WRITES NOTHING (Block 7.2a) ────────────
    // total_priced sums priced lots that are NOT thin; lots_priced counts them
    // thin or not. So a ranch whose every lot priced off a thin reference came
    // out as total_value 0 with lots_priced 2 — a withheld total stored as a
    // real zero. Test Ranch's 2026-09-10 row is exactly that, sitting between
    // two ~88k days, and lib/trend.ts differenced against it and reported a
    // $481,564 gain.
    //
    // Zero is not a valuation. It is the absence of one, and this column cannot
    // say so: total_value is NOT NULL (026:28), so the honest record of "we
    // could not value this ranch today" is no row at all. Readers already
    // handle a gap — they compare the two most recent rows, whatever their
    // dates, and say "since {that date}".
    //
    // Nothing here rewrites history; the zero rows already on record stay until
    // PK rules on them.
    if (!(est.total_priced > 0)) { unvalued++; continue }
    rows.push({
      user_id:       u.user_id,       // who last wrote the ranch's profile row, else its first owner (NOT NULL column; placement fallback)
      ranch_id:      u.ranch_id,      // the row's subject (050)
      snapshot_date: snapshotDate,
      total_value:   est.total_priced,
      lots_priced:   est.lots_priced,
      lots_total:    est.lots_total,
      tier:          est.tier,
      county_fips:   fips,
      as_of:         est.as_of,
      per_lot:       est.perLot,
    })
  }

  // 5) Append — idempotent on (ranch_id, snapshot_date) since 050; chunked.
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await db.from('herd_estimate_history').upsert(chunk, { onConflict: 'ranch_id,snapshot_date' })
    if (error) { console.error('[herd-estimate-snapshot] upsert failed:', error.message); process.exit(1) }
    written += chunk.length
  }

  console.log(`[herd-estimate-snapshot] ${snapshotDate}: ${users.length} ranch herds → ${written} recorded, ${skipped} skipped (no home county), ${unvalued} skipped (no usable valuation — every priced lot thin, or none priced)`)
}

main().catch(err => {
  console.error('[herd-estimate-snapshot] threw:', err instanceof Error ? err.message : err)
  process.exit(1)
})
