-- ============================================================
-- 015_hay_photos_bucket.sql
-- Reproduces the 'hay-photos' Supabase Storage bucket + access
-- policies in version control. The bucket exists in production but
-- was created by hand (Storage UI) and was never tracked, so a
-- rebuild from migrations would break photo upload/serving.
--
-- GROUND TRUTH (verified via the Storage API 2026-06-02):
--   id / name:          hay-photos
--   public:             true        (public bucket → reads need no SELECT policy)
--   file_size_limit:    5242880     (5 MB)
--   allowed_mime_types: image/jpeg, image/png, image/webp, image/heic
--
-- POLICIES (confirmed against live Storage → Policies 2026-06-02):
--   Production has exactly TWO policies on storage.objects for this
--   bucket, both correct and working. They are reproduced verbatim
--   below (names / command / role) for rebuild accuracy:
--     1. "Users can upload their own photos" — INSERT, role authenticated
--     2. "anyone can view hay photos"        — SELECT, role public
--   The predicate expressions follow the canonical Supabase patterns
--   that match these names and the app's "{user_id}/{listing_id}/<file>"
--   upload path. If you want byte-exact predicates, dump the live
--   definitions and compare (read-only):
--     select policyname, cmd, roles, qual, with_check
--     from pg_policies
--     where schemaname='storage' and tablename='objects'
--       and policyname in ('Users can upload their own photos',
--                          'anyone can view hay photos');
--
-- ⚠️  SECURITY ADVISORY (intentionally left as-is): Supabase flags that
--   a public SELECT policy on storage.objects allows anonymous callers
--   to LIST objects in the bucket, not just fetch known URLs. We are
--   knowingly keeping this — it is a public bucket of public hay images.
--   May be tightened later as part of broader security hardening.
--
-- REPO-ONLY: do NOT run the policy section against production — the
-- live policies are already correct. This file exists so a from-scratch
-- rebuild reproduces production exactly. ADDITIVE / guarded: the bucket
-- insert uses ON CONFLICT DO NOTHING and each policy is created only if
-- absent, so a fresh run is safe and idempotent. NON-DESTRUCTIVE.
-- ============================================================

-- 1) Bucket -------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hay-photos',
  'hay-photos',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do nothing;

-- 2) "anyone can view hay photos" — SELECT, role public -----------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'anyone can view hay photos'
  ) then
    create policy "anyone can view hay photos"
      on storage.objects for select to public
      using (bucket_id = 'hay-photos');
  end if;
end $$;

-- 3) "Users can upload their own photos" — INSERT, role authenticated
--    Scoped to the uploader's own folder, matching the client path
--    convention "{user_id}/{listing_id}/...".
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Users can upload their own photos'
  ) then
    create policy "Users can upload their own photos"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'hay-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
