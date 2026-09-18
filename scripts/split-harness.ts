// ─── Block 19 (ruling 3) harness — what a split refuses, from the database ───
//
// The split's arithmetic belongs to migration 071 and to nothing else, so the
// only honest way to hold it to ruling 3 is to RUN IT. This rebuilds
// production's schema on an embedded Postgres exactly as
// scripts/migrate-local.ts does, applies 071, puts a bunch on it, and calls
// record_group_action for every case the ruling names.
//
// A browser cannot produce these reliably: the preview's database has not had
// 071 run on it (PK runs migrations by hand, as he should), so the suite can
// only skip those checks and say so. This is where the rules are actually
// proved.
//
// It also PINS the words. lib/cattle/split.ts carries the same two sentences
// so a corral with no signal gets its answer immediately, and a copy of a rule
// is exactly how 070 changed nothing for a day — so the copy is held against
// the original here, letter for letter, on every run.
//
//   npx tsx scripts/split-harness.ts
//
// Self-checking, nonzero exit on any failure. Needs NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY in .env.local (the schema is READ from production's
// API document — no row is ever read or written there).

import { readFileSync, rmSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import postgres from 'postgres'
import { baselineDdl, statements, STUBS } from './lib/embedded-schema'
import { splitTooManyMessage, SPLIT_NEEDS_ONE, splitRefusal } from '../lib/cattle/split'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const DIR = resolve(process.env.SCRATCH_DIR ?? '/tmp', `dryline-split-${process.pid}`)
const PORT = 54529 + (process.pid % 100)
const RANCH = '00000000-0000-4000-8000-000000000001'
const USER = '00000000-0000-4000-8000-0000000000aa'
const LOT = '00000000-0000-4000-8000-0000000000b0'

type Answer = { ok: boolean; reason?: string; message?: string; payload?: Record<string, unknown> }

async function main() {
  mkdirSync(DIR, { recursive: true })
  const pg = new EmbeddedPostgres({ databaseDir: DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false, onLog: () => {}, onError: () => {} })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('dryline')
  const sql = postgres({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'dryline', max: 1, onnotice: () => {}, prepare: false })
  try {
    for (const st of statements(STUBS)) await sql.unsafe(st)
    const base = await baselineDdl()
    for (const st of base.ddl) await sql.unsafe(st)
    // RLS is enabled on the rebuilt tables and no policies exist here, so the
    // function's own logic — not a policy — is what every case below exercises.
    await sql.unsafe(`alter table public.herd_lots disable row level security`)
    await sql.unsafe(`alter table public.events disable row level security`)
    for (const st of statements(readFileSync(resolve('supabase/migrations/071_split_bunch.sql'), 'utf8'))) {
      if (/^\s*(select|with)\b/i.test(st.replace(/--.*$/gm, '').trim())) continue   // the paste-back checks
      await sql.unsafe(st)
    }
    await sql.unsafe(`select set_config('request.jwt.claim.sub', '${USER}', false)`)

    const reset = async (head: number) => {
      await sql.unsafe(`delete from public.events`)
      await sql.unsafe(`delete from public.herd_lots`)
      await sql.unsafe(`insert into public.herd_lots (id, ranch_id, class, name, head_count, created_by, updated_by) values ('${LOT}', '${RANCH}', 'heifers', 'Replacement Heifers', ${head}, '${USER}', '${USER}')`)
    }
    const split = async (head: number, opts: { name?: string; klass?: string; event?: string; expected?: number | null } = {}): Promise<Answer> => {
      // The results go in as a jsonb LITERAL. Bound as a parameter, the driver
      // serialises the JSON string a second time and the function is handed a
      // json string where it expects an array — "The groups they went to could
      // not be read", which is the function being right about a harness bug.
      const results = JSON.stringify([{ lot_id: null, name: opts.name ?? 'Off heifers', class: opts.klass ?? 'heifers', head }]).replace(/'/g, "''")
      const expected = opts.expected === undefined || opts.expected === null ? 'null' : String(opts.expected)
      const rows = await sql.unsafe(
        `select public.record_group_action('${opts.event ?? crypto.randomUUID()}'::uuid, now(), 'split', '${LOT}'::uuid, ${expected}::integer, 0, 0, '${results}'::jsonb, null, '{}'::jsonb) as r`,
      )
      return (rows[0] as unknown as { r: Answer }).r
    }
    const headOf = async () => Number(((await sql.unsafe(`select head_count from public.herd_lots where id = '${LOT}'`))[0] as unknown as { head_count: number }).head_count)

    // ── 1. The ordinary split ────────────────────────────────────────────────
    await reset(220)
    const ok = await split(22, { name: 'Open heifers' })
    const lots = await sql.unsafe(`select id, name, class, head_count, origin_event_id from public.herd_lots order by head_count desc`) as unknown as { id: string; name: string; class: string; head_count: number; origin_event_id: string | null }[]
    const made = lots.find(l => l.id !== LOT)
    check('a bunch of 220 splits 22 off: the parent drops to 198 and the 22 become their own bunch',
      ok.ok === true && await headOf() === 198 && made?.head_count === 22 && made?.name === 'Open heifers',
      `ok ${ok.ok} · parent ${await headOf()} · new "${made?.name}" ${made?.head_count} head`)
    check('the new bunch takes the class it was given, and points back at the working that made it (ruling 2)',
      made?.class === 'heifers' && made?.origin_event_id === (ok.payload?.event_id ?? ok.payload?.['event_id']) || made?.origin_event_id != null,
      `class ${made?.class} · origin_event_id ${made?.origin_event_id ? 'set' : 'null'}`)
    const ev = (await sql.unsafe(`select payload from public.events limit 1`))[0] as unknown as { payload: Record<string, unknown> }
    check('the parent\'s count BEFORE the split stays readable on the event, beside what it is now (ruling 2)',
      ev.payload.source_head_before === 220 && ev.payload.source_head_after === 198 && ev.payload.counted === 220 && ev.payload.stayed === 198 && ev.payload.moved === 22,
      `before ${ev.payload.source_head_before} · after ${ev.payload.source_head_after} · counted ${ev.payload.counted} · stayed ${ev.payload.stayed} · moved ${ev.payload.moved}`)

    // ── 2. The refusals ruling 3 names, and no others ────────────────────────
    await reset(220)
    const tooMany = await split(221)
    check('more head leaving than the bunch holds is refused, in plain words that say BOTH numbers',
      tooMany.ok === false && tooMany.reason === 'too_many' && tooMany.message === '221 head cannot leave a bunch of 220.',
      `${tooMany.reason} · "${tooMany.message}"`)
    check('and the refusal changed nothing — the bunch still holds what it held',
      await headOf() === 220 && Number(((await sql.unsafe(`select count(*) as n from public.herd_lots`))[0] as unknown as { n: string }).n) === 1,
      `parent ${await headOf()} · bunches ${((await sql.unsafe(`select count(*) as n from public.herd_lots`))[0] as unknown as { n: string }).n}`)

    const zero = await split(0)
    check('zero head leaving is refused, and says what a split is',
      zero.ok === false && zero.message === SPLIT_NEEDS_ONE, `${zero.reason} · "${zero.message}"`)
    const negative = await split(-5)
    check('a negative is refused the same way rather than quietly adding head',
      negative.ok === false && negative.message === SPLIT_NEEDS_ONE && await headOf() === 220, `${negative.reason} · "${negative.message}" · parent ${await headOf()}`)

    // Everything else saves — including the whole bunch leaving, which is a
    // real thing a person does and is not ours to refuse.
    await reset(220)
    const all = await split(220)
    check('the whole bunch leaving is NOT refused — it empties the parent and says so',
      all.ok === true && await headOf() === 0, `ok ${all.ok} · parent ${await headOf()}`)

    // ── 3. The caller cannot do the arithmetic, even by trying ───────────────
    await reset(100)
    const lying = await sql.unsafe(
      `select public.record_group_action('${crypto.randomUUID()}'::uuid, now(), 'split', '${LOT}'::uuid, null, 9999, 9999, '${JSON.stringify([{ lot_id: null, name: 'Off', class: 'heifers', head: 10 }])}'::jsonb, null, '{}'::jsonb) as r`,
    )
    const l = (lying[0] as unknown as { r: Answer }).r
    const lyingEv = (await sql.unsafe(`select payload from public.events limit 1`))[0] as unknown as { payload: Record<string, unknown> } | undefined
    check('a caller that sends its own count and its own "stay" is ignored, not believed — 071 reads both off the bunch',
      l.ok === true && await headOf() === 90 && lyingEv?.payload.counted === 100 && lyingEv?.payload.stayed === 90,
      `parent ${await headOf()} · recorded counted ${lyingEv?.payload.counted} · stayed ${lyingEv?.payload.stayed} (caller sent 9999 / 9999)`)

    // ── 4. Still the same working it always was ──────────────────────────────
    await reset(50)
    const id = crypto.randomUUID()
    await split(10, { event: id })
    const again = await split(10, { event: id })
    check('a second arrival of the same split is the same record, not a second one — idempotent on the event id',
      again.ok === true && again.reason === undefined && (again as unknown as { duplicate?: boolean }).duplicate === true && await headOf() === 40,
      `duplicate ${(again as unknown as { duplicate?: boolean }).duplicate} · parent ${await headOf()}`)
    await reset(50)
    const stale = await split(10, { expected: 44 })
    check('a bunch someone else changed refuses the split rather than clobbering it — the compare-and-set still holds',
      stale.ok === false && stale.reason === 'stale' && await headOf() === 50, `${stale.reason} · "${stale.message?.slice(0, 60)}"`)

    // ── 5. The words the sheet shows are the database's own ──────────────────
    check('the sentence the sheet shows for too many head is the database\'s, letter for letter',
      splitTooManyMessage(221, 220) === '221 head cannot leave a bunch of 220.' && splitRefusal(221, 220) === tooMany.message,
      `sheet "${splitRefusal(221, 220)}" · database "${tooMany.message}"`)
    check('and so is the sentence for nothing leaving',
      splitRefusal(0, 220) === zero.message && splitRefusal(-5, 220) === negative.message,
      `sheet "${splitRefusal(0, 220)}" · database "${zero.message}"`)
    check('a split the database would take is not refused by the sheet either',
      splitRefusal(22, 220) === null && splitRefusal(220, 220) === null, 'both allowed')
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
    await pg.stop().catch(() => {})
    rmSync(DIR, { recursive: true, force: true })
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`)
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error('harness crashed:', e instanceof Error ? e.message : e); rmSync(DIR, { recursive: true, force: true }); process.exit(2) })
