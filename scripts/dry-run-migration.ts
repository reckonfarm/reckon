// ─── Migration dry run: the whole file inside one transaction, always rolled back ──
//
// A migration nobody has run is a draft (PK, 2026-09-07 — 050's backfill reached
// production with a 42P10 reference error). This runs a migration file against the
// REAL schema over a direct Postgres connection, inside BEGIN … ROLLBACK, and prints
// every NOTICE and the result rows of every SELECT in the file (the pre-flight
// counts and the verify queries), so a syntax or reference error surfaces in seconds
// and the verify output is seen BEFORE anyone applies it. Nothing persists: the
// transaction is always rolled back, even on success (sequences may advance — harmless).
//
//   npx tsx scripts/dry-run-migration.ts supabase/migrations/050_lots_to_ranch.sql
//
// Needs SUPABASE_DB_URL in .env.local (gitignored): Supabase → Project Settings →
// Database → Connection string → "Session" pooler (port 5432), with the database
// password filled in. It is a POSTGRES credential, not the service-role key; it
// never leaves this machine and this script never COMMITs.
//
// Limits: `create index concurrently` cannot run in a transaction (none of ours do);
// DDL locks are held for the seconds the run takes; a file that is not idempotent
// still leaves nothing behind because everything rolls back.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import postgres from 'postgres'

for (const f of ['.env', '.env.local']) { const p = resolve(process.cwd(), f); if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '') } }

const file = process.argv[2]
if (!file) { console.error('usage: npx tsx scripts/dry-run-migration.ts supabase/migrations/<file>.sql'); process.exit(2) }
const path = resolve(process.cwd(), file)
if (!relative(resolve(process.cwd(), 'supabase/migrations'), path).match(/^[^.]/)) { console.error('refusing: only files under supabase/migrations are dry-run'); process.exit(2) }
const url = process.env.SUPABASE_DB_URL
if (!url) { console.error('SUPABASE_DB_URL is not set in .env.local (Supabase → Settings → Database → Connection string, Session pooler, port 5432)'); process.exit(2) }

// Split on statement-ending semicolons at end of line, keeping $$ bodies whole.
function statements(sql: string): string[] {
  const out: string[] = []; let buf = ''; let inDollar = false
  for (const line of sql.split('\n')) {
    const stripped = line.replace(/--.*$/, '')
    if ((stripped.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar
    buf += line + '\n'
    if (!inDollar && /;\s*$/.test(stripped)) { if (buf.replace(/--.*$/gm, '').trim()) out.push(buf.trim()); buf = '' }
  }
  if (buf.replace(/--.*$/gm, '').trim()) out.push(buf.trim())
  return out
}

async function main() {
  const text = readFileSync(path, 'utf8')
  const stmts = statements(text)
  const sql = postgres(url!, { max: 1, onnotice: n => console.log(`  NOTICE: ${n.message}`), prepare: false })
  console.log(`\nDRY RUN ${relative(process.cwd(), path)} — ${stmts.length} statement(s), inside one transaction, rolled back at the end\n`)
  let failed: { i: number; err: string; stmt: string } | null = null
  try {
    await sql.begin(async tx => {
      for (let i = 0; i < stmts.length; i++) {
        const stmt = stmts[i]
        const head = stmt.replace(/--.*$/gm, '').trim().split('\n')[0].slice(0, 90)
        try {
          const rows = await tx.unsafe(stmt)
          if (/^\s*(select|with)\b/i.test(stmt.replace(/--.*$/gm, '').trim())) {
            console.log(`[${i + 1}] ${head}`)
            if (rows.length === 0) console.log('      (0 rows)')
            for (const r of rows.slice(0, 20)) console.log('      ' + JSON.stringify(r))
            if (rows.length > 20) console.log(`      … ${rows.length - 20} more`)
          } else {
            console.log(`[${i + 1}] ok   ${head}${typeof rows.count === 'number' && rows.count > 0 ? `  (${rows.count} row(s) affected)` : ''}`)
          }
        } catch (e) {
          failed = { i: i + 1, err: e instanceof Error ? e.message : String(e), stmt }
          throw e   // aborts the transaction → rollback
        }
      }
      throw new Error('__DRY_RUN_ROLLBACK__')   // success path still rolls back
    })
  } catch (e) {
    if (!(e instanceof Error && e.message === '__DRY_RUN_ROLLBACK__') && !failed) console.error('connection / transaction error:', e instanceof Error ? e.message : e)
  } finally {
    await sql.end({ timeout: 5 })
  }
  if (failed) {
    const f = failed as { i: number; err: string; stmt: string }
    console.error(`\nFAILED at statement ${f.i}: ${f.err}\n---\n${f.stmt}\n---\nRolled back. Nothing was applied.\n`)
    process.exit(1)
  }
  console.log('\nDRY RUN OK — every statement ran; rolled back, nothing applied.\n')
}
main()
