import 'server-only'
import { Resend } from 'resend'
import { createServiceClient } from './supabase'

export interface HayMatchResult {
  checked: number
  sent:    number
  skipped: number
  errors:  string[]
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959 // miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

/**
 * Called by the Thursday cron after checkAndSendAlerts().
 * For every county in D2+ this week, finds active sell/donate listings
 * within 200 miles and emails the listing owner once per county per week.
 */
export async function checkHayMatchAlerts(weekDate: string): Promise<HayMatchResult> {
  const db = createServiceClient()

  // 1. Counties in D2+ this week
  const { data: droughtRows, error: dErr } = await db
    .from('drought_data')
    .select('county_id, d2, d3, d4')
    .eq('week_date', weekDate)

  if (dErr) throw new Error(`Drought data fetch failed: ${dErr.message}`)

  const dryCountyIds = (droughtRows ?? [])
    .filter(d => ((d.d2 ?? 0) + (d.d3 ?? 0) + (d.d4 ?? 0)) > 0)
    .map(d => d.county_id)

  if (dryCountyIds.length === 0) return { checked: 0, sent: 0, skipped: 0, errors: [] }

  // 2. Coords for dry counties
  const { data: dryCounties } = await db
    .from('counties')
    .select('id, fips, name, state, lat, lon')
    .in('id', dryCountyIds)

  const dryWithCoords = (dryCounties ?? []).filter(
    (c): c is typeof c & { lat: number; lon: number } => c.lat != null && c.lon != null,
  )

  if (dryWithCoords.length === 0) return { checked: 0, sent: 0, skipped: 0, errors: [] }

  // 3. Active sell/donate listings with county coords
  const { data: listings, error: lErr } = await db
    .from('hay_listings')
    .select('id, user_id, haul_radius_miles, counties(id, name, state, lat, lon)')
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .in('listing_type', ['sell', 'donate'])

  if (lErr) throw new Error(`Listings fetch failed: ${lErr.message}`)
  if (!listings || listings.length === 0) return { checked: 0, sent: 0, skipped: 0, errors: [] }

  // 4. Email addresses for listing owners
  const userIds = [...new Set(listings.map(l => l.user_id))]
  const { data: profiles } = await db
    .from('profiles')
    .select('id, email')
    .in('id', userIds)

  const emailByUser: Record<string, string> = Object.fromEntries(
    (profiles ?? []).map(p => [p.id as string, p.email as string]),
  )

  // TODO: this inline Resend usage predates lib/email.ts. It should eventually be
  // refactored into a sendHayMatchAlert() in lib/email.ts to share the single email
  // pattern (see sendDroughtAlert / sendHayRadarMatch). Left unchanged for now.
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { checked: 0, sent: 0, skipped: 0, errors: ['RESEND_API_KEY not set'] }
  const resend = new Resend(apiKey)

  let sent    = 0
  let skipped = 0
  let checked = 0
  const errors: string[] = []

  // 5. Fan out: dry county × listing; alert if within 200 miles and not deduped
  for (const dry of dryWithCoords) {
    for (const listing of listings) {
      const county = listing.counties as unknown as {
        id: number; name: string; state: string; lat: number | null; lon: number | null
      }
      if (county.lat == null || county.lon == null) continue

      const distMiles = haversine(dry.lat, dry.lon, county.lat, county.lon)
      if (distMiles > 200) continue

      checked++
      const email = emailByUser[listing.user_id]
      if (!email) continue

      const { count } = await db
        .from('hay_alert_sent')
        .select('id', { count: 'exact', head: true })
        .eq('listing_user_id', listing.user_id)
        .eq('dry_county_id', dry.id)
        .eq('week_date', weekDate)

      if ((count ?? 0) > 0) { skipped++; continue }

      const mi = Math.round(distMiles)
      const subject = `${dry.name} Co., ${dry.state} just hit D2 drought — nearby hay opportunity`
      const body = [
        `${dry.name} County, ${dry.state} entered severe drought (D2) this week.`,
        '',
        `Ranchers in that area may be looking to buy hay. Your Dryline listing in`,
        `${county.name}, ${county.state} is ${mi} mile${mi !== 1 ? 's' : ''} away.`,
        '',
        'View the Hay Network: https://dryline.farm/hay',
        '',
        'You are receiving this because you have an active hay listing on Dryline.',
        'Manage your listings: https://dryline.farm/hay',
      ].join('\n')

      try {
        const { error } = await resend.emails.send({
          from: 'Dryline Alerts <alerts@dryline.farm>',
          to: email,
          subject,
          text: body,
        })

        if (error) throw new Error(`Resend error: ${error.message}`)

        await db.from('hay_alert_sent').insert({
          listing_user_id: listing.user_id,
          dry_county_id:   dry.id,
          week_date:       weekDate,
        })

        sent++
      } catch (err) {
        errors.push(
          `${dry.fips} → ${email}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  return { checked, sent, skipped, errors }
}
