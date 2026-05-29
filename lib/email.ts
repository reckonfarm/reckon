import 'server-only'
import { Resend } from 'resend'
import { LFP_DISCLAIMER } from './lfp-eligibility'
import { estimatePayment } from './lfp-payment'

export interface DroughtAlertEmailParams {
  to:                 string
  countyName:         string
  state:              string
  fips:               string
  tier:               number
  payments:           number
  tierLabel:          string
  grazingPeriodStart: string
  grazingPeriodEnd:   string
  weekDate:           string
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

function formatDollars(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  })
}

export async function sendDroughtAlert(params: DroughtAlertEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)

  const {
    to, countyName, state, fips, tier, payments,
    tierLabel, grazingPeriodStart, grazingPeriodEnd, weekDate,
  } = params

  // Per-100-head adult beef reference — we don't have user head counts yet.
  // Once operation profiles are built, swap in the user's actual head count.
  const est = estimatePayment('beef_adult', 100, payments)
  const estAmount = formatDollars(est.grossEstimate)

  const subject =
    `${countyName}, ${state} just hit LFP Tier ${tier} — est. ${estAmount} available`

  const body = [
    `${countyName} County, ${state} has triggered LFP Tier ${tier}.`,
    '',
    `Trigger:        ${tierLabel}`,
    `USDM release:   ${formatDate(weekDate)}`,
    `Grazing period: ${formatDate(grazingPeriodStart)} – ${formatDate(grazingPeriodEnd)}`,
    '',
    `Tier ${tier} = ${payments} monthly LFP payment${payments !== 1 ? 's' : ''}`,
    `Est. payment:   ${estAmount} per 100 adult beef cattle`,
    '',
    'This is a reference estimate only. Your actual payment depends on your enrolled',
    'head count and eligible acreage. Enter your numbers at:',
    `https://dryline.farm/dashboard?fips=${fips}`,
    '',
    '─'.repeat(60),
    LFP_DISCLAIMER,
    '',
    'You are receiving this alert because you added this county to your Dryline watchlist.',
    'Manage your counties: https://dryline.farm/watchlist',
  ].join('\n')

  const { error } = await resend.emails.send({
    from: 'Dryline Alerts <alerts@dryline.farm>',
    to,
    subject,
    text: body,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)
}

// ─── Demand routing (buyer want → opted-in seller) ────────────────────────────

export interface DemandRoutingEmailParams {
  to:         string
  hayType:    string
  countyName: string
  state:      string
  tonnage:    number | null
  miles:      number
  wantId:     number
}

export async function sendDemandRoutingMatch(params: DemandRoutingEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)

  const { to, hayType, countyName, state, tonnage, miles, wantId } = params

  const wantingLine = tonnage != null
    ? `is looking for about ${tonnage} tons of ${hayType}`
    : `is looking for ${hayType}`

  const subject = `A buyer near you is looking for ${hayType}`

  const body = [
    `A rancher in ${countyName}, ${state} ${wantingLine}.`,
    `That's roughly ${miles} mile${miles !== 1 ? 's' : ''} from your hay.`,
    '',
    'If you can supply it, respond directly to the buyer here:',
    `https://dryline.farm/hay/${wantId}`,
    '',
    "You're receiving this because you opted into buyer-demand alerts.",
    'Turn these off in your profile: https://dryline.farm/profile',
  ].join('\n')

  const { error } = await resend.emails.send({
    from: 'Dryline Alerts <alerts@dryline.farm>',
    to,
    subject,
    text: body,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)
}

// ─── Hay Radar match ────────────────────────────────────────────────────────

export interface HayRadarMatchEmailParams {
  to:          string
  hayType:     string
  countyName:  string
  state:       string
  pricePerTon: number | null
  tonnage:     number | null
  listingType: string          // 'sell' | 'donate'
  listingId:   number
  searchLabel: string | null
}

export async function sendHayRadarMatch(params: HayRadarMatchEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)

  const {
    to, hayType, countyName, state, pricePerTon, tonnage, listingType, listingId, searchLabel,
  } = params

  const priceLine =
    listingType === 'donate'
      ? 'Donation / relief listing'
      : pricePerTon != null
        ? `${formatDollars(pricePerTon)}/ton`
        : 'Price: contact seller'

  const subject = `New hay matches your search: ${hayType} in ${state}`

  const body = [
    searchLabel
      ? `A new listing matches your saved search "${searchLabel}":`
      : 'A new listing matches a search you saved on Dryline Hay Radar:',
    '',
    `${hayType} — ${countyName}, ${state}`,
    priceLine,
    tonnage != null ? `${tonnage} tons available` : null,
    '',
    `View the listing: https://dryline.farm/hay/${listingId}`,
    '',
    'You are receiving this because it matched a search you saved on Dryline Hay Radar.',
    'Manage your searches: https://dryline.farm/radar',
  ].filter((line): line is string => line !== null).join('\n')

  const { error } = await resend.emails.send({
    from: 'Dryline Alerts <alerts@dryline.farm>',
    to,
    subject,
    text: body,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)
}
