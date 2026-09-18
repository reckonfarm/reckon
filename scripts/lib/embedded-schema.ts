// ─── The embedded schema, shared (Block 19) ──────────────────────────────────
// scripts/migrate-local.ts rebuilds production's CURRENT schema on an embedded
// Postgres so a candidate migration can be RUN before it reaches PK's screen.
// scripts/split-harness.ts needs the same thing for a different reason — to
// run a migration and then call the function it defines — so the machinery
// lives here rather than in two copies that drift.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

export const MIG = resolve(process.cwd(), 'supabase/migrations')

// Statement splitter: ends at a ';' at end of line, outside $tag$ … $tag$ bodies.
export function statements(sql: string): string[] {
  const out: string[] = []; let buf = ''; let tag: string | null = null
  for (const line of sql.split('\n')) {
    const code = line.replace(/--.*$/, '')
    for (const m of code.matchAll(/\$[A-Za-z_]*\$/g)) { if (tag === null) tag = m[0]; else if (m[0] === tag) tag = null }
    buf += line + '\n'
    if (tag === null && /;\s*$/.test(code)) { if (buf.replace(/--.*$/gm, '').trim()) out.push(buf.trim()); buf = '' }
  }
  if (buf.replace(/--.*$/gm, '').trim()) out.push(buf.trim())
  return out
}

export const STUBS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema auth, storage to anon, authenticated, service_role;
`

// ─── Production's schema, rebuilt: every public table, its columns, types, and primary key ──
export function loadEnv() { for (const f of ['.env', '.env.local']) { const p = resolve(process.cwd(), f); if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '') } } }
const PG_TYPE: Record<string, string> = { 'character varying': 'text', text: 'text', uuid: 'uuid', integer: 'integer', bigint: 'bigint', smallint: 'smallint', numeric: 'numeric', 'double precision': 'double precision', real: 'real', boolean: 'boolean', date: 'date', 'timestamp with time zone': 'timestamptz', 'timestamp without time zone': 'timestamp', jsonb: 'jsonb', json: 'json', character: 'text', ARRAY: 'text[]', 'text[]': 'text[]', bytea: 'bytea', time: 'time', 'time without time zone': 'time' }
export async function baselineDdl(): Promise<{ ddl: string[]; tables: number }> {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — the schema is read from production\'s API document')
  const spec = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json()) as { definitions: Record<string, { properties: Record<string, { type?: string; format?: string; description?: string }> }> }
  const ddl: string[] = []
  const tables = Object.entries(spec.definitions)
  for (const [table, def] of tables) {
    const cols: string[] = []; const pks: string[] = []
    for (const [col, p] of Object.entries(def.properties)) {
      const fmt = (p.format ?? p.type ?? 'text')
      const t = PG_TYPE[fmt] ?? (fmt.endsWith('[]') ? 'text[]' : 'text')
      if (/<pk\/>/.test(p.description ?? '')) pks.push(col)
      cols.push(`"${col}" ${t}`)
    }
    if (pks.length) cols.push(`primary key (${pks.map(c => `"${c}"`).join(', ')})`)
    ddl.push(`create table if not exists public.${table} (${cols.join(', ')});`)
    ddl.push(`alter table public.${table} enable row level security;`)
  }
  // Named UNIQUE constraints the migrations created — inline `unique (cols)` in a create
  // table (Postgres names them <table>_<cols>_key) and `add constraint <name> unique (…)` —
  // so a candidate that drops or relies on one meets it here, by its real name.
  const all = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(join(MIG, f), 'utf8').replace(/--.*$/gm, '')).join('\n')
  const seen = new Set<string>()
  for (const m of all.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
    const table = m[1].toLowerCase()
    for (const u of m[2].matchAll(/(?:constraint\s+([a-z_]+)\s+)?unique\s*\(([^)]+)\)/gi)) {
      const cols = u[2].split(',').map(c => c.trim().replace(/"/g, '')); const name = u[1] ?? `${table}_${cols.join('_')}_key`
      if (!seen.has(name)) { seen.add(name); ddl.push(`do $$ begin if to_regclass('public.${table}') is not null then begin alter table public.${table} add constraint ${name} unique (${cols.map(c => `"${c}"`).join(', ')}); exception when others then null; end; end if; end $$;`) }
    }
  }
  for (const m of all.matchAll(/alter table (?:if exists )?(?:public\.)?([a-z_]+)\s+add constraint\s+([a-z_]+)\s+unique\s*\(([^)]+)\)/gi)) {
    const table = m[1].toLowerCase(), name = m[2], cols = m[3].split(',').map(c => c.trim().replace(/"/g, ''))
    if (!seen.has(name)) { seen.add(name); ddl.push(`do $$ begin if to_regclass('public.${table}') is not null then begin alter table public.${table} add constraint ${name} unique (${cols.map(c => `"${c}"`).join(', ')}); exception when others then null; end; end if; end $$;`) }
  }
  // Unique targets the files reference by FK that a primary key does not already cover.
  ddl.push(`do $$ begin if not exists (select 1 from pg_constraint where conrelid = 'public.counties'::regclass and contype in ('p','u') and conkey = array[(select attnum from pg_attribute where attrelid = 'public.counties'::regclass and attname = 'fips')]) then alter table public.counties add constraint counties_fips_uniq unique (fips); end if; end $$;`)
  return { ddl, tables: tables.length }
}

