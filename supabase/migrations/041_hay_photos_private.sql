-- ============================================================
-- 041_hay_photos_private.sql
-- Block 1C step 6 — the hay-photos bucket holds ranchers' own listing photos
-- (3 objects on 2026-09-05, all under user folders), not public assets, so it
-- goes PRIVATE. Reads now go through lib/hay-photos.ts, which mints one-hour
-- signed URLs with the service role; new uploads store the storage path, and
-- legacy public URLs already in hay_listings.photo_urls are reduced to their
-- path before signing (no data rewrite needed).
--
-- The "anyone can view hay photos" SELECT policy (015) is dropped: with a
-- private bucket the public-URL route is closed at the bucket level, and the
-- service role that signs URLs bypasses RLS, so the policy only remained as a
-- listing/enumeration door for the anon key. The authenticated upload policy
-- (own folder only) is untouched.
--
-- Idempotent, order-independent (depends only on 015's bucket existing),
-- non-orphaning (no objects touched). Run in the Supabase SQL editor.
-- ============================================================

update storage.buckets
   set public = false
 where id = 'hay-photos';

drop policy if exists "anyone can view hay photos" on storage.objects;
