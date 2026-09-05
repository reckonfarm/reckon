-- ============================================================
-- 044_ranch_member_last_seen.sql
-- Block 2E — "Since you last checked". One timestamp per member: when this
-- person last had the ranch's Today in front of them. Read on the
-- user-scoped client through "own membership readable" (034); written ONLY
-- by POST /api/seen with the service role after a membership check — no
-- UPDATE policy is added to ranch_members (a member-side UPDATE policy would
-- also expose role). Null = never seen; the block then reads "since
-- yesterday" for the first visit.
--
-- Idempotent, additive, non-orphaning, order-independent (needs 034).
-- Run in the Supabase SQL editor.
-- ============================================================

alter table public.ranch_members
  add column if not exists last_seen_at timestamptz;

-- Verify: expect the column, nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'ranch_members' and column_name = 'last_seen_at';
