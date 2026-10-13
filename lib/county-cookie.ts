// ─── The county a phone remembers (Block 49, ruling R1) ──────────────────────
// Signed out, Markets and Weather open on the county this phone last looked
// at — picked by name or found by "Near me". A cookie, not localStorage, so
// the server can paint the county on the first byte. A signed-in person's
// Markets and Weather still open on the home county; this is never read for
// them. Public information only: a county is not ranch data.
export const COUNTY_COOKIE = 'dryline_county'

export function rememberCounty(fips: string): void {
  try { document.cookie = `${COUNTY_COOKIE}=${encodeURIComponent(fips)}; path=/; max-age=31536000; samesite=lax` } catch { /* no document */ }
}
