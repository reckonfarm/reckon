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
// per-county USDM calls). Records HONESTLY even when unpriced (total 0 / lots_priced 0 / tier) —
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

  // 2) Users with a herd — service-role bypasses the owner-RLS, so we see all of them.
  const { data: opRows, error: opErr } = await db
    .from('operation_profiles')
    .select('user_id, herd')
    .not('herd', 'is', null)
  if (opErr) { console.error('[herd-estimate-snapshot] operation_profiles read failed:', opErr.message); process.exit(1) }
  const users = (opRows ?? [])
    .map(r => ({ user_id: (r as { user_id: string }).user_id, lots: extractLots((r as { herd: unknown }).herd) }))
    .filter(u => u.lots.length > 0)

  if (users.length === 0) { console.log('[herd-estimate-snapshot] no herds with lots — nothing to do.'); return }

  // 3) Home county per user (profiles.home_county_fips), then county centroids.
  const homeByUser = new Map<string, string>()
  const ids = users.map(u => u.user_id)
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
  for (const u of users) {
    const fips = homeByUser.get(u.user_id)
    const c = fips ? centroidByFips.get(fips) : undefined
    if (!fips || !c) { skipped++; continue }
    const resolved: ResolveResult = {
      county_fips: fips, county_name: c.name, centroid: { lat: c.lat, lon: c.lon },
      ...rankFreshBarns({ lat: c.lat, lon: c.lon }, barns, now),
    }
    const est = estimateHerd({ lots: u.lots }, resolved)
    rows.push({
      user_id:       u.user_id,
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

  // 5) Append — idempotent on (user_id, snapshot_date); chunked.
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await db.from('herd_estimate_history').upsert(chunk, { onConflict: 'user_id,snapshot_date' })
    if (error) { console.error('[herd-estimate-snapshot] upsert failed:', error.message); process.exit(1) }
    written += chunk.length
  }

  console.log(`[herd-estimate-snapshot] ${snapshotDate}: ${users.length} herds → ${written} recorded, ${skipped} skipped (no home county)`)
}

main().catch(err => {
  console.error('[herd-estimate-snapshot] threw:', err instanceof Error ? err.message : err)
  process.exit(1)
})
