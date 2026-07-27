-- ============================================================
-- 031_devices_events_places.sql
-- S1 — the three-table ranch ledger (North Star v3 §6: THREE TABLES, forever).
--
-- DEVICES emit EVENTS at PLACES. Every future product is a new device type +
-- event types in these same tables — zero new architecture. The decision log
-- was never built; `events` is its FIRST home (decisions are events with a
-- null device_id), so there is NO legacy data to migrate.
--
-- CONVENTIONS MIRRORED:
--   • operation_profiles (020): thin-by-design — typed columns ONLY for what a
--     query filters on; everything else rides a jsonb payload. Promote a jsonb
--     field to a typed column only when a query actually needs it.
--   • herd_estimate_history (026): owner-scoped RLS; the ledger is
--     tamper-resistant (events are append-only from clients — no update/delete
--     policies; corrections are NEW events).
--
-- OWNERSHIP: per-ranch = per-user today (user_id → auth.uid(), like every
-- private table here). ON DELETE CASCADE from auth.users on all three tables
-- honors the plain-English instant-total-delete promise (§4).
--
-- ⚠️  ACCESS CLIENTS:
--   • places / devices / decision-events: user-scoped SSR client
--     (lib/supabase-server.ts) — runs AS the user, respects RLS.
--   • hardware ingestion (tank webhook → edge function, courier sync sweeps):
--     service-role client — BYPASSES RLS by design, exactly like the 026 cron.
--
-- Idempotent (create … if not exists; policies drop-guarded), additive only,
-- non-orphaning (SET NULL, never cascade, on intra-ledger FKs), and
-- order-independent (depends only on auth.users; no extensions, no triggers,
-- no data migration). Tables are created places → devices → events so the
-- forward references resolve within this one file.
--
-- Run in the Supabase SQL editor.
-- ============================================================

-- 1) places ------------------------------------------------------
-- Named ground: fields, tanks, stackyards. Geometry is GeoJSON jsonb (this
-- repo's GeoJSON-not-TopoJSON, no-PostGIS posture) and NULLABLE — a place can
-- be named before anyone draws it. Promote to PostGIS only when a query needs
-- real spatial ops.
create table if not exists public.places (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  -- 'field' | 'tank' | 'stackyard' | … — text, NOT an enum: a new place kind
  -- must never require a migration.
  kind        text        not null,
  -- GeoJSON geometry (Polygon for fields, Point for tanks), or null if undrawn.
  geometry    jsonb,
  created_at  timestamptz not null default now(),
  -- App-stamped on write (020's convention — no trigger function in this repo).
  updated_at  timestamptz not null default now()
);

create index if not exists places_user_idx on public.places (user_id);

-- 2) devices -----------------------------------------------------
-- The registry the Devices tab lists: every puck / tank node / kit — what it
-- is, where it sits, how it's doing. Display-state columns only; raw readings
-- (voltage curves, levels) belong to `events` payloads (RAW-DATA doctrine).
create table if not exists public.devices (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  -- Stable physical identifier (serial / BLE MAC) — how the webhook maps an
  -- inbound report to this row and how pairing claims hardware. Globally
  -- unique: a physical device belongs to one ranch at a time.
  hardware_id text        not null unique,
  -- 'puck' | 'puck_lite' | 'tank_node' | 'bed_kit' | … — text, not an enum:
  -- a new device type must never require a migration.
  type        text        not null,
  name        text        not null,
  -- Where it's assigned; unassigned (drawer, in transit) is a real state.
  -- SET NULL: deleting a place never blocks nor destroys hardware records.
  place_id    uuid        references public.places(id) on delete set null,
  -- Display cache for the Devices tab (0–100). The honest raw battery curve
  -- lives in event payloads; this is just "what the list shows".
  battery_pct smallint    check (battery_pct between 0 and 100),
  last_seen   timestamptz,
  fw_version  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists devices_user_idx  on public.devices (user_id);
create index if not exists devices_place_idx on public.devices (place_id);

-- 3) events ------------------------------------------------------
-- THE LEDGER — the crown jewel. One row per thing that happened: a tank
-- reading, a bale drop, a feed run, a human decision. Decisions are events
-- with device_id NULL (no emitter). Thin typed spine; everything
-- reading-shaped rides `payload` + `schema_version` (RAW-DATA doctrine).
create table if not exists public.events (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  -- Emitter, or NULL for human events. SET NULL: deleting/decommissioning a
  -- device must never destroy its history — the ledger outlives the hardware.
  device_id      uuid        references public.devices(id) on delete set null,
  -- 'tank_level' | 'bale_drop' | 'feed_run' | 'decision' | … — text, not an
  -- enum: new event types must never require a migration.
  type           text        not null,
  -- When it HAPPENED on the ranch (device clock / user intent). Distinct from
  -- ingested_at below: courier batch-sync and webhook retries mean arrival can
  -- lag occurrence by hours — one timestamp would lie about one or the other.
  ts             timestamptz not null,
  -- Where it happened (event's own fix, e.g. from the courier phone or a GPS
  -- puck). Deliberately NO place_id: which place this falls in is a DERIVED
  -- spatial question answered later against places.geometry.
  lat            double precision,
  lng            double precision,
  -- The full raw reading/decision body. schema_version stamps the payload
  -- shape so old rows stay readable forever as shapes evolve.
  payload        jsonb       not null default '{}'::jsonb,
  schema_version smallint    not null default 1,
  -- Optional caller-supplied idempotency key (webhooks are at-least-once;
  -- courier re-syncs will double-post). No guessed natural key — two honest
  -- same-type readings in the same second must both be storable.
  dedup_key      text,
  -- Server receipt time — the server-authoritative stamp (026's captured_at).
  ingested_at    timestamptz not null default now()
);

-- The Activity feed: one user's merged ledger, newest first.
create index if not exists events_user_ts_idx   on public.events (user_id, ts desc);
-- Per-device history (Devices tab drill-in, S2+).
create index if not exists events_device_ts_idx on public.events (device_id, ts desc);
-- Idempotent ingestion: same (user, dedup_key) can't land twice. Partial —
-- costs nothing for rows that don't use it.
create unique index if not exists events_user_dedup_idx
  on public.events (user_id, dedup_key) where dedup_key is not null;

-- 4) Row Level Security ------------------------------------------

-- places + devices: full owner-scoped CRUD (the user manages their own
-- registry and ground), exactly 020's four-policy posture.
alter table public.places  enable row level security;
alter table public.devices enable row level security;

drop policy if exists "own places readable"   on public.places;
create policy "own places readable"
  on public.places  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own places insertable" on public.places;
create policy "own places insertable"
  on public.places  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own places updatable"  on public.places;
create policy "own places updatable"
  on public.places  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own places deletable"  on public.places;
create policy "own places deletable"
  on public.places  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "own devices readable"   on public.devices;
create policy "own devices readable"
  on public.devices for select to authenticated using (user_id = auth.uid());
drop policy if exists "own devices insertable" on public.devices;
create policy "own devices insertable"
  on public.devices for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own devices updatable"  on public.devices;
create policy "own devices updatable"
  on public.devices for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own devices deletable"  on public.devices;
create policy "own devices deletable"
  on public.devices for delete to authenticated using (user_id = auth.uid());

-- events: APPEND-ONLY for clients (026's tamper-resistant posture). Owner may
-- read and insert their own rows; there are deliberately NO update/delete
-- policies — a correction is a NEW event, the ledger never rewrites. Hardware
-- ingestion writes via the service-role client, which bypasses RLS by design.
alter table public.events enable row level security;

drop policy if exists "own events readable"   on public.events;
create policy "own events readable"
  on public.events  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own events insertable" on public.events;
create policy "own events insertable"
  on public.events  for insert to authenticated with check (user_id = auth.uid());
