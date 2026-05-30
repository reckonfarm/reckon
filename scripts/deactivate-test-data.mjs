// Pre-launch cleanup: DEACTIVATE manual hand-testing data for two accounts.
// Reversible — sets active=false / opt_in=false only. NO deletes, NO cascades.
//
//   node scripts/deactivate-test-data.mjs
//
// Does exactly three things, each scoped to the two known user IDs:
//   1. hay_listings ids 14,16,17,18,21,23 -> active=false
//   2. saved_searches id 1               -> active=false
//   3. profiles (both accounts)          -> demand_routing_opt_in=false
// Leaves the 17 already-inactive listings and the 1 demand_routing_sent log as-is.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const env = loadEnv('.env.local')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// The two accounts, resolved in the audit — scope every write to these IDs.
const USER_IDS = [
  '7c3aeaf8-a6b1-4fa1-a4c2-ee79abc0a1a4', // kiehl.preston@gmail.com
  'b13ec844-3a02-406b-a3f7-e7f373adc217', // haleyzoe20@gmail.com
]
const LISTING_IDS = [14, 16, 17, 18, 21, 23]
const SAVED_SEARCH_ID = 1

const main = async () => {
  // 1. Deactivate the 6 active listings (scoped to our user_ids as a guard).
  const { data: l, error: lErr } = await db
    .from('hay_listings')
    .update({ active: false })
    .in('id', LISTING_IDS)
    .in('user_id', USER_IDS)
    .select('id')
  if (lErr) throw lErr
  console.log(`1. hay_listings deactivated: ${l.map(r => r.id).sort((a, b) => a - b).join(', ')} (${l.length} rows)`)

  // 2. Deactivate the saved search.
  const { data: s, error: sErr } = await db
    .from('saved_searches')
    .update({ active: false })
    .eq('id', SAVED_SEARCH_ID)
    .in('user_id', USER_IDS)
    .select('id')
  if (sErr) throw sErr
  console.log(`2. saved_searches deactivated: ${s.map(r => r.id).join(', ')} (${s.length} rows)`)

  // 3. Turn off demand routing opt-in on both profiles.
  const { data: p, error: pErr } = await db
    .from('profiles')
    .update({ demand_routing_opt_in: false })
    .in('id', USER_IDS)
    .select('id')
  if (pErr) throw pErr
  console.log(`3. profiles demand_routing_opt_in -> false: ${p.length} rows`)

  console.log('\nDone. No deletes performed.')
}

main().catch(e => { console.error('ERROR:', e.message ?? e); process.exit(1) })
