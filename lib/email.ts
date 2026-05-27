import 'server-only'
import { Resend } from 'resend'
import { LFP_DISCLAIMER } from './lfp-eligibility'
import { estimatePayment } from './lfp-payment'

const resend = new Resend(process.env.RESEND_API_KEY)

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
    `https://reckon.farm/dashboard?fips=${fips}`,
    '',
    '─'.repeat(60),
    LFP_DISCLAIMER,
    '',
    'You are receiving this alert because you added this county to your Reckon watchlist.',
    'Manage your counties: https://reckon.farm/watchlist',
  ].join('\n')

  const { error } = await resend.emails.send({
    from: 'Reckon Alerts <alerts@reckon.farm>',
    to,
    subject,
    text: body,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)
}
