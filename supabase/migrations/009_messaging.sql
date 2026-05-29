-- ============================================================
-- 009_messaging.sql
--
-- ⚠️  ALREADY APPLIED TO PRODUCTION — committed for repo parity only.
--     Run directly in the Supabase SQL Editor during the messaging build.
--     Reproduced here so supabase/migrations/ matches the live database.
--
-- In-app messaging + structured offers. A thread between a buyer and the
-- listing's seller is the deal context; a mutual "mark closed" replaces the
-- 6.2 claim/confirm handshake and feeds the existing review gate.
-- ============================================================

-- 1. One thread per (listing, buyer). Seller is always the listing owner.
CREATE TABLE IF NOT EXISTS public.hay_threads (
  id                  bigserial primary key,
  listing_id          integer not null references public.hay_listings (id) on delete cascade,
  buyer_user_id       uuid    not null references auth.users (id) on delete cascade,
  seller_user_id      uuid    not null references auth.users (id) on delete cascade,
  created_at          timestamptz not null default now(),
  last_message_at     timestamptz not null default now(),
  buyer_last_read_at  timestamptz,
  seller_last_read_at timestamptz,
  closed_status       text not null default 'open'
    CHECK (closed_status IN ('open','buyer_marked','seller_marked','closed','declined')),
  unique (listing_id, buyer_user_id)
);

CREATE INDEX IF NOT EXISTS hay_threads_buyer_idx
  ON public.hay_threads (buyer_user_id, last_message_at desc);
CREATE INDEX IF NOT EXISTS hay_threads_seller_idx
  ON public.hay_threads (seller_user_id, last_message_at desc);
CREATE INDEX IF NOT EXISTS hay_threads_listing_idx
  ON public.hay_threads (listing_id);

-- 2. Messages — plain text, structured offer, or a system event line.
CREATE TABLE IF NOT EXISTS public.hay_messages (
  id                  bigserial primary key,
  thread_id           bigint not null references public.hay_threads (id) on delete cascade,
  sender_user_id      uuid   not null references auth.users (id) on delete cascade,
  body                text,
  message_type        text not null default 'text'
    CHECK (message_type IN ('text','offer','system')),
  offer_price_per_ton numeric,
  offer_tonnage       numeric,
  offer_status        text
    CHECK (offer_status IS NULL OR offer_status IN ('pending','accepted','countered','declined')),
  created_at          timestamptz not null default now()
);

-- Serves both chronological load and the ?after=<id> poll cursor.
CREATE INDEX IF NOT EXISTS hay_messages_thread_idx
  ON public.hay_messages (thread_id, id);
