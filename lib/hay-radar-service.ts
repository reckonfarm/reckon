import 'server-only'
import { createServiceClient } from './supabase'
import { sendHayRadarMatch } from './email'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RadarResult {
  checked: number
  sent:    number
  skipped: number   // dedup hits (already sent / claimed)
  errors:  string[]
}

interface SavedSearchRow {
  id:                 number
  user_id:            string
  state:              string | null
  hay_type:           string | null
  listing_type:       string | null
  max_price_per_ton:  number | null
  max_distance_miles: number | null
  origin_county_id:   number | null
  label:              string | null
  active:             boolean
}

interface MatchListing {
  id:            number
  user_id:       string
  listing_type:  string
  hay_type:      string | null
  price_per_ton: number | null
  tonnage:       number | null
  counties: { id: number; name: string; state: string; lat: number | null; lon: number | null } | null
}

interface MatchContext {
  searches:    SavedSearchRow[]
  originById:  Record<number, { lat: number | null; lon: number | null }>
  emailByUser: Record<string, string>
}

const LISTING_SELECT =
  'id, user_id, listing_type, hay_type, price_per_ton, tonnage, counties(id, name, state, lat, lon)'

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

// ─── Context load (active searches + origin coords + owner emails) ─────────────

async function loadContext(db: DbClient): Promise<MatchContext> {
  const { data: searchData } = await db
    .from('saved_searches')
    .select('id, user_id, state, hay_type, listing_type, max_price_per_ton, max_distance_miles, origin_county_id, label, active')
    .eq('active', true)

  const searches = (searchData ?? []) as SavedSearchRow[]

  const originIds = [...new Set(searches.map(s => s.origin_county_id).filter((v): v is number => v != null))]
  const originById: Record<number, { lat: number | null; lon: number | null }> = {}
  if (originIds.length > 0) {
    const { data: cs } = await db.from('counties').select('id, lat, lon').in('id', originIds)
    for (const c of (cs ?? []) as { id: number; lat: number | null; lon: number | null }[]) {
      originById[c.id] = { lat: c.lat, lon: c.lon }
    }
  }

  const userIds = [...new Set(searches.map(s => s.user_id))]
  const emailByUser: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profs } = await db.from('profiles').select('id, email').in('id', userIds)
    for (const p of (profs ?? []) as { id: string; email: string | null }[]) {
      if (p.email) emailByUser[p.id] = p.email
    }
  }

  return { searches, originById, emailByUser }
}

// ─── Pure match predicate — any NULL criterion = no constraint ─────────────────

function listingMatches(
  listing: MatchListing,
  s: SavedSearchRow,
  originById: Record<number, { lat: number | null; lon: number | null }>,
): boolean {
  const county = listing.counties
  if (s.state && county?.state !== s.state) return false
  if (s.hay_type && (listing.hay_type ?? '').toLowerCase() !== s.hay_type.toLowerCase()) return false
  if (s.listing_type && listing.listing_type !== s.listing_type) return false

  if (s.max_price_per_ton != null) {
    // A price ceiling can't be satisfied by a listing with no price.
    if (listing.price_per_ton == null) return false
    if (listing.price_per_ton > s.max_price_per_ton) return false
  }

  if (s.max_distance_miles != null && s.origin_county_id != null) {
    const o = originById[s.origin_county_id]
    if (!o || o.lat == null || o.lon == null || county?.lat == null || county?.lon == null) return false
    if (haversine(o.lat, o.lon, county.lat, county.lon) > s.max_distance_miles) return false
  }

  return true
}

// ─── Core: match a batch of listings against the loaded searches ───────────────

async function processListings(
  db: DbClient,
  listings: MatchListing[],
  ctx: MatchContext,
): Promise<RadarResult> {
  let checked = 0
  let sent    = 0
  let skipped = 0
  const errors: string[] = []

  for (const listing of listings) {
    // Radar only surfaces hay a buyer can acquire — never 'want' listings.
    if (listing.listing_type !== 'sell' && listing.listing_type !== 'donate') continue

    for (const s of ctx.searches) {
      if (s.user_id === listing.user_id) continue          // never email an owner about their own listing
      if (!listingMatches(listing, s, ctx.originById)) continue

      checked++

      // Dedup-with-retry: claim the (search, listing) pair first. The unique
      // constraint guarantees only one claim wins (no concurrent double-send).
      const { data: claim, error: claimErr } = await db
        .from('hay_radar_sent')
        .insert({ saved_search_id: s.id, listing_id: listing.id })
        .select('id')
        .single()

      if (claimErr) {
        if ((claimErr as { code?: string }).code === '23505') { skipped++; continue } // already sent/claimed
        errors.push(`claim search ${s.id} / listing ${listing.id}: ${claimErr.message}`)
        continue
      }

      const email = ctx.emailByUser[s.user_id]
      if (!email) {
        // No address — release the claim so a future run can retry.
        await db.from('hay_radar_sent').delete().eq('id', claim.id)
        skipped++
        continue
      }

      try {
        await sendHayRadarMatch({
          to:          email,
          hayType:     listing.hay_type ?? 'Hay',
          countyName:  listing.counties?.name ?? '',
          state:       listing.counties?.state ?? '',
          pricePerTon: listing.price_per_ton,
          tonnage:     listing.tonnage,
          listingType: listing.listing_type,
          listingId:   listing.id,
          searchLabel: s.label,
        })
        sent++
      } catch (err) {
        // Send failed — release the claim so the daily safety-net cron retries.
        await db.from('hay_radar_sent').delete().eq('id', claim.id)
        errors.push(`send search ${s.id} / listing ${listing.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return { checked, sent, skipped, errors }
}

// ─── Entry points ──────────────────────────────────────────────────────────────

/**
 * PRIMARY trigger. Called via after() once a listing is committed by POST /api/hay.
 * Matches that one new listing against all active saved searches. Must never throw
 * into the caller — POST wraps it, and a thrown error here just means the daily
 * cron will catch the miss.
 */
export async function matchNewListing(listingId: number): Promise<RadarResult> {
  const db = createServiceClient()

  const { data: listing } = await db
    .from('hay_listings')
    .select(LISTING_SELECT)
    .eq('id', listingId)
    .eq('active', true)
    .single()

  if (!listing) return { checked: 0, sent: 0, skipped: 0, errors: [] }
  const row = listing as unknown as MatchListing
  if (row.listing_type !== 'sell' && row.listing_type !== 'donate') {
    return { checked: 0, sent: 0, skipped: 0, errors: [] }
  }

  const ctx = await loadContext(db)
  if (ctx.searches.length === 0) return { checked: 0, sent: 0, skipped: 0, errors: [] }

  return processListings(db, [row], ctx)
}

/**
 * SAFETY-NET trigger. Daily cron sweep — re-checks every sell/donate listing
 * created in the last ~48h against all active saved searches. Dedup means
 * already-emailed pairs are skipped; only inline misses get sent.
 */
export async function sweepRecentRadar(): Promise<RadarResult> {
  const db = createServiceClient()

  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data: listingData } = await db
    .from('hay_listings')
    .select(LISTING_SELECT)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .in('listing_type', ['sell', 'donate'])
    .gte('created_at', since)

  const rows = (listingData ?? []) as unknown as MatchListing[]
  if (rows.length === 0) return { checked: 0, sent: 0, skipped: 0, errors: [] }

  const ctx = await loadContext(db)
  if (ctx.searches.length === 0) return { checked: 0, sent: 0, skipped: 0, errors: [] }

  return processListings(db, rows, ctx)
}
