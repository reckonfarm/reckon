// ============================================================
// lib/freight.ts — delivered-cost engine
//
// The single tunable source of truth for the delivered-$/ton number.
// Ranchers think in ONE figure: what hay costs delivered to their place,
// per ton. delivered = listing price + (road miles × freight rate).
//
// Tune the constants below WITHOUT a code change by setting the
// NEXT_PUBLIC_ env vars in Vercel; otherwise the defaults apply.
//   FREIGHT_RATE_PER_TON_MILE — default 0.12
//     (DAT West flatbed ~$2.92/loaded mile ÷ ~25-ton full load ≈ $0.117 ≈ 0.12;
//      national flatbed ~$3.44/mi sits at ~0.14. 2025–2026 rates.)
//   ROAD_CIRCUITY_FACTOR — default 1.3
//     (roads aren't straight lines; great-circle × 1.3 ≈ road miles,
//      mid of the real 1.2–1.4 range)
//   MIN_FREIGHT_PER_TON — default 8
//     (short-haul floor; ~$200 over a 25-ton load — a truck won't roll for less)
//
// Every number this produces is an ESTIMATE assuming a full truckload.
// It must never be presented as a quoted freight price.
// ============================================================

export const FREIGHT_RATE_PER_TON_MILE =
  Number(process.env.NEXT_PUBLIC_FREIGHT_RATE_PER_TON_MILE ?? 0.12)

export const ROAD_CIRCUITY_FACTOR =
  Number(process.env.NEXT_PUBLIC_ROAD_CIRCUITY_FACTOR ?? 1.3)

// Short-haul minimum freight per ton. Below this, a one-way mileage charge
// understates reality — no carrier dispatches a full truck for a trivial fee.
// $8/ton × ~25-ton load ≈ $200 minimum to roll. Only binds on short lanes
// (a 100-mi lane at 0.12 ≈ $16/ton already clears it).
export const MIN_FREIGHT_PER_TON =
  Number(process.env.NEXT_PUBLIC_MIN_FREIGHT_PER_TON ?? 8)

export interface LatLon {
  lat: number | null
  lon: number | null
}

export interface DeliverableListing {
  listing_type: string
  price_per_ton: number | null
  counties: LatLon | null
}

export interface DeliveredCost {
  base:          number  // listing price_per_ton ($/ton)
  miles:         number  // circuity-adjusted road miles, rounded
  freightPerTon: number  // estimated freight ($/ton), rounded
  delivered:     number  // base + freight ($/ton), rounded
}

// Straight-line great-circle distance in miles.
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// Circuity-adjusted road miles between two points.
export function roadMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineMiles(lat1, lon1, lat2, lon2) * ROAD_CIRCUITY_FACTOR
}

// Estimated delivered cost per ton for a buyer at `buyer` receiving `listing`.
// Returns null (→ show listing price only, never an error) when:
//   - no buyer county is known
//   - the listing isn't a 'sell' (a 'want'/'donate' has no price to deliver)
//   - the listing has no base price_per_ton
//   - the seller county has no coordinates
export function deliveredCost(
  buyer: LatLon | null | undefined,
  listing: DeliverableListing,
): DeliveredCost | null {
  if (!buyer || buyer.lat == null || buyer.lon == null) return null
  if (listing.listing_type !== 'sell') return null
  if (listing.price_per_ton == null) return null
  const sc = listing.counties
  if (!sc || sc.lat == null || sc.lon == null) return null

  const miles = Math.round(roadMiles(buyer.lat, buyer.lon, sc.lat, sc.lon))
  // Apply the short-haul floor before rounding so trivial lanes don't read $0/ton.
  const freightPerTon = Math.round(
    Math.max(miles * FREIGHT_RATE_PER_TON_MILE, MIN_FREIGHT_PER_TON),
  )
  const base = listing.price_per_ton
  return {
    base,
    miles,
    freightPerTon,
    delivered: Math.round(base + freightPerTon),
  }
}
