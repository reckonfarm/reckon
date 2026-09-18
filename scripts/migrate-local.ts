// ─── Migration validation: the candidate runs, for real, on production's schema ──
//
// The rule (PK, 2026-09-07): a migration nobody has run is a draft. Two files in a
// row reached PK with errors a single execution catches in seconds (050's lateral
// join, 053's name[] = text[]). With no database connection string on this machine,
// this rebuilds production's CURRENT schema on an EMBEDDED Postgres (npm
// embedded-postgres — no Docker, no CLI): every public table with its columns,
// types, and primary keys as production's PostgREST OpenAPI document reports them
// (a read-only GET with the service key), plus stubs for what the files reference
// from Supabase (auth.users + auth.uid(), storage.*, the anon / authenticated /
// service_role roles). Then the CANDIDATE file runs against it, statement by
// statement, printing every SELECT's rows and every NOTICE. The cluster is deleted.
//
//   npx tsx scripts/migrate-local.ts supabase/migrations/053_herd_blob_retired.sql
//
// What this proves: syntax, types, references, policy / constraint / trigger
// validity — the classes that have failed on PK's screen. What it cannot prove:
// production DATA (the tables here are empty) and pre-existing constraint NAMES
// (the API document carries none) — a `drop constraint if exists` no-ops here and
// a DO block that looks constraints up finds none. Run the data pre-flight on
// production with the service role separately, as before.

import { readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import postgres from 'postgres'
import { MIG, STUBS, statements, baselineDdl } from './lib/embedded-schema'
const target = process.argv[2]
const DIR = resolve(process.env.SCRATCH_DIR ?? '/tmp', `dryline-pg-${process.pid}`)
const PORT = 54329 + (process.pid % 100)

async function main() {
  if (!target) { console.error('usage: npx tsx scripts/migrate-local.ts supabase/migrations/<file>.sql'); process.exit(2) }
  const path = resolve(process.cwd(), target)
  if (!existsSync(path) || !path.startsWith(MIG)) { console.error('the file must be under supabase/migrations'); process.exit(2) }
  const candidate = path.slice(MIG.length + 1)
  mkdirSync(DIR, { recursive: true })
  const pg = new EmbeddedPostgres({ databaseDir: DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false, onLog: () => {}, onError: () => {} })
  console.log(`\nMIGRATION VALIDATION — ${candidate} on production's schema, embedded Postgres :${PORT}\n`)
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('dryline')
  const sql = postgres({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'dryline', max: 1, onnotice: n => console.log(`      NOTICE: ${n.message}`), prepare: false })
  let failed = false
  try {
    for (const st of statements(STUBS)) await sql.unsafe(st)
    const base = await baselineDdl()
    for (const st of base.ddl) await sql.unsafe(st)
    console.log(`schema rebuilt: ${base.tables} table(s) from production's API document, named uniques from the migrations\n`)
    const stmts = statements(readFileSync(path, 'utf8'))
    let i = 0
    try {
      for (const st of stmts) {
        i++
        const head = st.replace(/--.*$/gm, '').trim().split('\n')[0].slice(0, 100)
        const rows = await sql.unsafe(st)
        if (/^\s*(select|with)\b/i.test(st.replace(/--.*$/gm, '').trim())) {
          console.log(`[${i}] ${head}`)
          if (rows.length === 0) console.log('      (0 rows)'); for (const r of rows.slice(0, 12)) console.log('      ' + JSON.stringify(r))
        } else console.log(`[${i}] ok   ${head}`)
      }
    } catch (e) {
      failed = true
      console.error(`\nFAILED at statement ${i} of ${stmts.length}: ${e instanceof Error ? e.message : e}\n---\n${stmts[i - 1]?.slice(0, 800)}\n---`)
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
    await pg.stop().catch(() => {})
    rmSync(DIR, { recursive: true, force: true })
  }
  if (failed) { console.error(`\nNOT VALID — fix and run again. Cluster discarded.\n`); process.exit(1) }
  console.log(`\nVALID — every statement of ${candidate} executed on production's schema. Cluster discarded.\n`)
}
main().catch(e => { console.error('runner crashed:', e instanceof Error ? e.message : e); rmSync(DIR, { recursive: true, force: true }); process.exit(2) })
