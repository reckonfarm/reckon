import 'server-only'
import { createServiceClient } from './supabase'
import { sendDemandRoutingMatch } from './email'

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_HAUL_MILES = 250          // economic haul cap when the buyer set none
const CAP_PER_7_DAYS     = 3            // max demand emails per seller per rolling 7 days

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DemandResult {
  checked: number
  sent:    number
  skipped: number   // dedup hits + capped + no-email
  capped:  number   // skipped specifically because the seller hit the 7-day cap
  errors:  string[]
}

interface WantListing {
  id:                number
  user_id:           string
  listing_type:      string
  hay_type:          string | null
  tonnage:           number | null
  haul_radius_miles: number | null
  counties: { id: number; name: string; state: string; lat: number | null; lon: number | null } | null
}

interface SellerListing {
  user_id:   string
  hay_type:  string | null
  counties:  { lat: number | null; lon: number | null } | null
}

interface SellerContext {
  // opted-in sellers → their email + their matching active listings (with coords)
  emailByUser:    Record<string, string>
  listingsByUser: Record<string, SellerListing[]>
}

const WANT_SELECT =
  'id, user_id, listing_type, hay_type, tonnage, haul_radius_miles, counties(id, name, state, lat, lon)'

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

type DbClient = ReturnType<typeof createServiceClient>

// ─── Context: opted-in sellers + their active sell/donate listings ─────────────

async function loadSellerContext(db: DbClient): Promise<SellerContext> {
  // Opted-in sellers only — the privacy gate. Default false means most users
  // never appear here.
  const { data: optedIn } = await db
    .from('profiles')
    .select('id, email')
    .eq('demand_routing_opt_in', true)

  const sellers = (optedIn ?? []) as { id: string; email: string | null }[]
  const emailByUser: Record<string, string> = {}
  for (const s of sellers) if (s.email) emailByUser[s.id] = s.email

  const sellerIds = Object.keys(emailByUser)
  const listingsByUser: Record<string, SellerListing[]> = {}
  if (sellerIds.length > 0) {
    const { data: listingData } = await db
      .from('hay_listings')
      .select('user_id, hay_type, counties(lat, lon)')
      .in('user_id', sellerIds)
      .eq('active', true)
      .gt('expires_at', new Date().toISOString())
      .in('listing_type', ['sell', 'donate'])

    for (const l of (listingData ?? []) as unknown as SellerListing[]) {
      (listingsByUser[l.user_id] ??= []).push(l)
    }
  }

  return { emailByUser, listingsByUser }
}

// Closest matching-hay listing distance (miles) from this seller to the want,
// or null if the seller has no in-criteria listing with usable coords.
function closestMatchMiles(want: WantListing, listings: SellerListing[]): number | null {
  const wc = want.counties
  if (!wc || wc.lat == null || wc.lon == null) return null
  const wantHay = (want.hay_type ?? '').toLowerCase()

  let best: number | null = null
  for (const l of listings) {
    if ((l.hay_type ?? '').toLowerCase() !== wantHay) continue   // hay_type-match scope
    const c = l.counties
    if (!c || c.lat == null || c.lon == null) continue
    const d = haversine(wc.lat, wc.lon, c.lat, c.lon)
    if (best == null || d < best) best = d
  }
  return best
}

// ─── Core: route one or more wants to opted-in sellers ─────────────────────────

async function processWants(
  db: DbClient,
  wants: WantListing[],
  ctx: SellerContext,
): Promise<DemandResult> {
  let checked = 0
  let sent    = 0
  let skipped = 0
  let capped  = 0
  const errors: string[] = []

  for (const want of wants) {
    if (want.listing_type !== 'want') continue
    const range = want.haul_radius_miles ?? DEFAULT_HAUL_MILES

    for (const sellerId of Object.keys(ctx.emailByUser)) {
      if (sellerId === want.user_id) continue                    // never email the buyer

      const listings = ctx.listingsByUser[sellerId]
      if (!listings || listings.length === 0) continue           // needs an active listing

      const miles = closestMatchMiles(want, listings)
      if (miles == null || miles > range) continue               // matching hay within haul range

      checked++

      // Frequency cap — count this seller's sends in the last rolling 7 days.
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      const { count: recent } = await db
        .from('demand_routing_sent')
        .select('id', { count: 'exact', head: true })
        .eq('seller_user_id', sellerId)
        .gte('sent_at', since)
      if ((recent ?? 0) >= CAP_PER_7_DAYS) { capped++; skipped++; continue }

      // Claim-first dedup: one email per (want, seller) ever.
      const { data: claim, error: claimErr } = await db
        .from('demand_routing_sent')
        .insert({ want_listing_id: want.id, seller_user_id: sellerId })
        .select('id')
        .single()

      if (claimErr) {
        if ((claimErr as { code?: string }).code === '23505') { skipped++; continue } // already sent
        errors.push(`claim want ${want.id} / seller ${sellerId}: ${claimErr.message}`)
        continue
      }

      const email = ctx.emailByUser[sellerId]
      if (!email) {
        await db.from('demand_routing_sent').delete().eq('id', claim.id)
        skipped++
        continue
      }

      try {
        await sendDemandRoutingMatch({
          to:         email,
          hayType:    want.hay_type ?? 'hay',
          countyName: want.counties?.name ?? '',
          state:      want.counties?.state ?? '',
          tonnage:    want.tonnage,
          miles:      Math.round(miles),
          wantId:     want.id,
        })
        sent++
      } catch (err) {
        // Release the claim so the daily cron retries (and the cap isn't consumed).
        await db.from('demand_routing_sent').delete().eq('id', claim.id)
        errors.push(`send want ${want.id} / seller ${sellerId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return { checked, sent, skipped, capped, errors }
}

// ─── Entry points ──────────────────────────────────────────────────────────────

/**
 * PRIMARY trigger. Called via after() once a WANT listing is committed by
 * POST /api/hay. Routes that one want to opted-in sellers with a matching-hay
 * active listing in haul range. Must never throw into the caller — POST wraps it,
 * and the daily cron catches any miss.
 */
export async function routeDemand(wantId: number): Promise<DemandResult> {
  const db = createServiceClient()

  const { data: want } = await db
    .from('hay_listings')
    .select(WANT_SELECT)
    .eq('id', wantId)
    .eq('active', true)
    .single()

  if (!want) return { checked: 0, sent: 0, skipped: 0, capped: 0, errors: [] }
  const row = want as unknown as WantListing
  if (row.listing_type !== 'want') return { checked: 0, sent: 0, skipped: 0, capped: 0, errors: [] }

  const ctx = await loadSellerContext(db)
  if (Object.keys(ctx.emailByUser).length === 0) return { checked: 0, sent: 0, skipped: 0, capped: 0, errors: [] }

  return processWants(db, [row], ctx)
}

/**
 * SAFETY-NET trigger. Daily cron sweep — re-routes want listings created in the
 * last ~48h to catch inline misses. Dedup + cap mean already-handled (want, seller)
 * pairs and capped sellers are skipped.
 */
export async function sweepRecentDemand(): Promise<DemandResult> {
  const db = createServiceClient()

  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data: wantData } = await db
    .from('hay_listings')
    .select(WANT_SELECT)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .eq('listing_type', 'want')
    .gte('created_at', since)

  const wants = (wantData ?? []) as unknown as WantListing[]
  if (wants.length === 0) return { checked: 0, sent: 0, skipped: 0, capped: 0, errors: [] }

  const ctx = await loadSellerContext(db)
  if (Object.keys(ctx.emailByUser).length === 0) return { checked: 0, sent: 0, skipped: 0, capped: 0, errors: [] }

  return processWants(db, wants, ctx)
}
