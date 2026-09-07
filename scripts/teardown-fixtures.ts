// ─── Sweep every test fixture off production, whatever left it there ──────────
// The suites tear down pre-run, on finish, and after a crash, and now on SIGINT /
// SIGTERM — but a hard kill (a machine asleep, a harness timeout) can still leave
// a fixture mid-run. This removes all of them at once by their KNOWN identities:
// the synthetic accounts (rls-test-*, smoke-*, audit-* @dryline.farm) and the
// PREFIX-named ranches. Real accounts and Test Ranch are untouchable here by
// construction: nothing matches them.
//
//   npx tsx scripts/teardown-fixtures.ts
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
for (const f of ['.env', '.env.local']) { const p = resolve(process.cwd(), f); if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '') } }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
const EMAIL_RE = /^(rls-test-[a-z]|smoke-[a-z-]+|audit-[a-z-]+)@dryline\.farm$/
const RANCH_RE = /^(RLS-TEST-|SMOKE-|AUDIT-)/
export async function sweep(label = 'sweep'): Promise<number> {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ids = (users?.users ?? []).filter(u => EMAIL_RE.test(u.email ?? '')).map(u => u.id)
  let n = 0
  if (ids.length) {
    for (const t of ['events', 'devices', 'places', 'herd_lots', 'operation_profiles', 'ranch_members', 'invitations']) {
      const col = t === 'herd_lots' ? 'created_by' : t === 'invitations' ? 'created_by' : 'user_id'
      n += (await admin.from(t).delete().in(col, ids).select('*')).data?.length ?? 0
    }
    n += (await admin.from('profiles').delete().in('id', ids).select('id')).data?.length ?? 0
  }
  const { data: ranches } = await admin.from('ranches').select('id, name')
  const junk = (ranches ?? []).filter(r => RANCH_RE.test(r.name)).map(r => r.id)
  if (junk.length) n += (await admin.from('ranches').delete().in('id', junk).select('id')).data?.length ?? 0   // cascades lots, members, invitations
  for (const id of ids) { await admin.auth.admin.deleteUser(id); n++ }
  console.log(`teardown-fixtures (${label}): removed ${n} row(s)/user(s) · ${ids.length} account(s) · ${junk.length} ranch(es)`)
  return n
}
if (process.argv[1] && /teardown-fixtures/.test(process.argv[1])) sweep().catch(e => { console.error(e); process.exit(1) })
