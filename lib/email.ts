import 'server-only'
import { Resend } from 'resend'
import { droughtClassWords, USDM_WORDS, type UsdmSummary } from './drought-words'

// Kill-switch: when EMAILS_DISABLED=1, every sender no-ops and returns immediately.
// Defaults to sending — only non-production environments (e.g. the e2e preview
// deploy) set this, so prod-targeted tests cannot email real users.
export function emailsDisabled(): boolean {
  return process.env.EMAILS_DISABLED === '1'
}

// Block 16 (ruling 2): the Thursday alert names the U.S. Drought Monitor,
// carries the valid date the release carries, and states the class in plain
// words. No eligibility, tier or payment language — that is FSA's
// determination and it lives on its own screen, one link away.
export interface DroughtAlertEmailParams {
  to:         string
  countyName: string
  state:      string
  fips:       string
  validDate:  string                 // YYYY-MM-DD — the Tuesday the release is valid for
  usdm:       UsdmSummary | null     // the county's reading for that release; null = not on file
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
  if (emailsDisabled()) return
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)

  const { to, countyName, state, fips, validDate, usdm } = params
  const classLine = usdm ? droughtClassWords(usdm) : 'The drought class for this release was not on file when this was sent'
  const short = usdm ? `${USDM_WORDS[usdm.level]} (D${usdm.level})` : 'drought update'

  const subject = `${countyName}, ${state}: ${short} — U.S. Drought Monitor, valid ${formatDate(validDate)}`

  const body = [
    `U.S. Drought Monitor — ${countyName}, ${state}`,
    `Valid ${formatDate(validDate)}`,
    '',
    `${classLine}.`,
    '',
    `This county on Dryline: https://dryline.farm/dashboard?fips=${fips}`,
    '',
    '─'.repeat(60),
    'Source: U.S. Drought Monitor, National Drought Mitigation Center. Any program determination is FSA\'s to make.',
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

// ─── Messaging (new message in a thread, recipient away) ──────────────────────

export interface MessageNotificationParams {
  to:         string
  senderName: string
  hayType:    string | null
  snippet:    string
  threadId:   number
}

export async function sendMessageNotification(params: MessageNotificationParams): Promise<void> {
  if (emailsDisabled()) return
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)

  const { to, senderName, hayType, snippet, threadId } = params

  const subject = hayType
    ? `New message about your ${hayType} listing`
    : 'New message on Dryline'

  const body = [
    `${senderName} sent you a message on Dryline:`,
    '',
    `“${snippet}”`,
    '',
    `Reply in your messages: https://dryline.farm/messages?thread=${threadId}`,
    '',
    'You receive these when you have an unread message and have been away.',
    'View all your conversations: https://dryline.farm/messages',
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
  if (emailsDisabled()) return
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
  if (emailsDisabled()) return
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

// ─── Invitation (Phase A2) ────────────────────────────────────────────────────
// The invite link goes by email through Resend, the same sender the alerts use.
// The route ALSO returns the link to the inviter, so when email is disabled
// (previews) or simply slow, the link can be texted — a legitimate v1 for a ranch.

export interface InviteEmailParams { to: string; inviterName: string; ranchName: string; role: 'owner' | 'member'; acceptUrl: string; expiresAt: string }

export async function sendInviteEmail(p: InviteEmailParams): Promise<boolean> {
  if (emailsDisabled()) return false
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  const resend = new Resend(apiKey)
  const expires = new Date(p.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const text = [
    `${p.inviterName} invited you to ${p.ranchName} on Dryline.`,
    '',
    `You'll be able to see and log feed, hay counts, rain, and ranch work${p.role === 'owner' ? ', and add or remove people' : ''}.`,
    '',
    `Accept the invitation: ${p.acceptUrl}`,
    '',
    `This link works until ${expires} and only for ${p.to}.`,
    '',
    'Dryline — your ranch, on the record.',
  ].join('\n')
  const { error } = await resend.emails.send({
    from: 'Dryline <alerts@dryline.farm>',
    to: p.to,
    subject: `${p.inviterName} invited you to ${p.ranchName}`,
    text,
  })
  if (error) throw new Error(`Resend error: ${error.message}`)
  return true
}
