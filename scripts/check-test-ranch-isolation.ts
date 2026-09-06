// ─── Test Ranch ↔ Kiehl Ranch isolation (read-only) ──────────────────────────
// Signs in as the Test Ranch owner and hand (password), as the Kiehl Ranch
// owner (a magic-link session minted with the service role — READ ONLY, on
// PK's instruction), and as anon; asserts each side sees only its own ranch,
// events, places, and members. Writes nothing. Exit 1 on any FAIL.
//
//   TEST_OWNER_PW=… TEST_HAND_PW=… npx tsx scripts/check-test-ranch-isolation.ts
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
for (const f of ['.env', '.env.local']) { const p = resolve(process.cwd(), f); if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '') } }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TEST_RANCH = '90d9fe59-9e41-4964-9728-a78eef262f64', KIEHL_RANCH = 'b5a0c9d4-7e31-4b8a-9f26-3c1d8e5a7f90'
const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
let fails = 0
const record = (who: string, check: string, pass: boolean, detail = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${who.padEnd(12)} ${check}${detail ? ` — ${detail}` : ''}`) }
const anon = () => createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
async function pwClient(email: string, password: string) { const c = anon(); const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw new Error(`${email}: ${error.message}`); return c }
async function linkClient(email: string) { const link = await admin.auth.admin.generateLink({ type: 'magiclink', email }); const c = anon(); const { error } = await c.auth.verifyOtp({ token_hash: link.data!.properties!.hashed_token, type: 'magiclink' }); if (error) throw new Error(`${email}: ${error.message}`); return c }
async function view(who: string, c: SupabaseClient, mine: string | null, theirs: string) {
  const ranches = (await c.from('ranches').select('id, name')).data ?? []
  const events = (await c.from('events').select('id, ranch_id')).data ?? []
  const places = (await c.from('places').select('id, ranch_id, name')).data ?? []
  const members = (await c.from('ranch_members').select('ranch_id, user_id')).data ?? []
  const theirsSeen = [...events, ...places, ...members].filter(r => r.ranch_id === theirs).length + ranches.filter(r => r.id === theirs).length
  record(who, `sees no rows of the other ranch`, theirsSeen === 0, `${theirsSeen} foreign row(s)`)
  if (mine) {
    record(who, `sees only its own ranch`, ranches.length === 1 && ranches[0].id === mine, ranches.map(r => r.name).join(', ') || 'none')
    record(who, `its events/places/members are all its own ranch`, [...events, ...places, ...members].every(r => r.ranch_id === mine), `${events.length} events · ${places.length} places · ${members.length} members`)
  } else {
    record(who, `sees nothing at all`, ranches.length + events.length + places.length + members.length === 0, `${ranches.length}/${events.length}/${places.length}/${members.length}`)
  }
}
async function main() {
  console.log(`\nTest Ranch isolation (${URL_})\n`)
  await view('test owner', await pwClient('kiehl.preston+testranch@gmail.com', process.env.TEST_OWNER_PW!), TEST_RANCH, KIEHL_RANCH)
  await view('test hand', await pwClient('kiehl.preston+testhand@gmail.com', process.env.TEST_HAND_PW!), TEST_RANCH, KIEHL_RANCH)
  await view('kiehl owner', await linkClient('kiehl.preston@gmail.com'), KIEHL_RANCH, TEST_RANCH)
  await view('anon', anon(), null, TEST_RANCH)
  console.log(`\n${fails ? `${fails} FAIL — BLOCKED` : 'all PASS'}\n`); process.exit(fails ? 1 : 0)
}
main().catch(e => { console.error('crashed:', e.message); process.exit(2) })
