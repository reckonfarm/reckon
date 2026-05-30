// READ-ONLY audit of manual hand-testing data for two accounts.
// Resolves user IDs by email, then lists hay_listings, saved_searches, and
// demand-routing opt-in / sent rows. Modifies NOTHING (only .select()).
//
//   node scripts/audit-test-data.mjs
//
// Loads service-role creds from .env.local.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// --- minimal .env.local loader (no extra deps) ---
function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const env = loadEnv('.env.local')
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const EMAILS = ['kiehl.preston@gmail.com', 'haleyzoe20@gmail.com']
const SENTINEL = /ZZZ-E2E|DONOTBUY/i // Playwright sentinels — flagged separately, ignored

function line() { console.log('─'.repeat(78)) }

const main = async () => {
  // 1. Resolve emails → user_id via profiles
  const { data: profs, error: pErr } = await db
    .from('profiles')
    .select('id, email, display_name, demand_routing_opt_in')
    .in('email', EMAILS)
  if (pErr) throw pErr

  console.log('\n# ACCOUNTS')
  line()
  if (!profs?.length) {
    console.log('No profiles found for those emails. Nothing else to report.')
    return
  }
  const byId = new Map()
  for (const p of profs) {
    byId.set(p.id, p.email)
    console.log(`${p.email}`)
    console.log(`  user_id:               ${p.id}`)
    console.log(`  display_name:          ${p.display_name ?? '(none)'}`)
    console.log(`  demand_routing_opt_in: ${p.demand_routing_opt_in}`)
  }
  const missing = EMAILS.filter(e => !profs.some(p => p.email === e))
  if (missing.length) console.log(`\n  ⚠ no profile row for: ${missing.join(', ')}`)
  const ids = profs.map(p => p.id)

  // 2. hay_listings (join county for readable name)
  const { data: listings, error: lErr } = await db
    .from('hay_listings')
    .select('id, hay_type, listing_type, active, created_at, description, counties(name, state)')
    .in('user_id', ids)
    .order('created_at', { ascending: true })
  if (lErr) throw lErr

  const real = (listings ?? []).filter(l => !SENTINEL.test(l.hay_type ?? '') && !SENTINEL.test(l.description ?? ''))
  const sentinels = (listings ?? []).filter(l => SENTINEL.test(l.hay_type ?? '') || SENTINEL.test(l.description ?? ''))

  console.log(`\n# HAY_LISTINGS  (${real.length} real; ${sentinels.length} E2E sentinel ignored)`)
  line()
  if (!real.length) {
    console.log('(none)')
  } else {
    for (const l of real) {
      const county = l.counties ? `${l.counties.name} Co., ${l.counties.state}` : '(no county)'
      console.log(
        `id ${String(l.id).padEnd(5)} | ${String(l.listing_type).padEnd(6)} | ` +
        `${String(l.hay_type ?? '').padEnd(16)} | active=${String(l.active).padEnd(5)} | ` +
        `${county.padEnd(22)} | ${new Date(l.created_at).toISOString().slice(0, 10)}`,
      )
    }
  }
  if (sentinels.length) {
    console.log(`\n  (ignored E2E sentinels: ids ${sentinels.map(s => s.id).join(', ')})`)
  }

  // 3. saved_searches
  const { data: searches, error: sErr } = await db
    .from('saved_searches')
    .select('id, label, state, hay_type, listing_type, max_price_per_ton, max_distance_miles, active, created_at, user_id')
    .in('user_id', ids)
    .order('created_at', { ascending: true })
  if (sErr) throw sErr

  console.log(`\n# SAVED_SEARCHES  (${searches?.length ?? 0})`)
  line()
  if (!searches?.length) {
    console.log('(none)')
  } else {
    for (const s of searches) {
      console.log(
        `id ${String(s.id).padEnd(5)} | ${(s.label ?? '(no label)').padEnd(20)} | ` +
        `state=${s.state ?? '-'} type=${s.hay_type ?? '-'} listing=${s.listing_type ?? '-'} ` +
        `maxPrice=${s.max_price_per_ton ?? '-'} maxDist=${s.max_distance_miles ?? '-'} | ` +
        `active=${s.active} | ${byId.get(s.user_id)}`,
      )
    }
  }

  // 4. demand_routing_sent (seller-side rows)
  const { data: dr, error: dErr } = await db
    .from('demand_routing_sent')
    .select('id, want_listing_id, seller_user_id, sent_at')
    .in('seller_user_id', ids)
    .order('sent_at', { ascending: true })
  if (dErr) throw dErr

  console.log(`\n# DEMAND_ROUTING`)
  line()
  console.log('opt-in flags (from profiles above):')
  for (const p of profs) console.log(`  ${p.email}: demand_routing_opt_in = ${p.demand_routing_opt_in}`)
  console.log(`\ndemand_routing_sent rows (${dr?.length ?? 0}):`)
  if (!dr?.length) {
    console.log('  (none)')
  } else {
    for (const r of dr) {
      console.log(`  id ${r.id} | want_listing_id=${r.want_listing_id} | seller=${byId.get(r.seller_user_id)} | ${new Date(r.sent_at).toISOString().slice(0, 10)}`)
    }
  }
  console.log('')
}

main().catch(e => { console.error('ERROR:', e.message ?? e); process.exit(1) })
