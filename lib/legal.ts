// ─── Legal identity — the one place the operator, contact, and processors live ──
//
// /terms and /privacy (content/*.md) and the site footer read these. When the
// Montana SOS amendment clears, OPERATOR is a one-line swap here and nowhere
// else. Nothing in this file is a placeholder: an empty CONTACT_EMAIL renders
// the mailing address alone (never an invented address) until PK supplies it.

export const OPERATOR =
  'Dryline is operated by Montana Cast Iron Solutions LLC, a Montana limited liability company, doing business as Dryline. A name change to Dryline Technologies LLC is pending with the Montana Secretary of State.'

/** Short legal name for the footer line. */
export const OPERATOR_NAME = 'Montana Cast Iron Solutions LLC, doing business as Dryline'

/** Business contact address. Interim Gmail until a dryline.farm mailbox exists — one-constant swap. */
export const CONTACT_EMAIL = 'reckon.farm@gmail.com'

export const MAILING_ADDRESS = '588 Kiehl Ranch Road, Winnett, Montana 59087'

/**
 * Days after account deletion within which residual copies in the provider's
 * encrypted daily backups purge. Supabase Pro: daily backups, 7-day retention
 * (PK confirmed the upgrade 2026-09-05). Null would name no number.
 */
export const BACKUP_RETENTION_DAYS: number | null = 7

/** Processors, by category. Payments is absent because no payment processor is live. */
export const PROCESSORS: readonly { category: string; name: string; purpose: string }[] = [
  { category: 'Hosting',        name: 'Vercel',   purpose: 'runs the site, plus Vercel Web Analytics and Speed Insights' },
  { category: 'Database',       name: 'Supabase', purpose: 'authentication and the database that holds your records' },
  { category: 'Email',          name: 'Resend',   purpose: 'sign-in codes, account notices, and alert emails' },
  { category: 'Sign-in',        name: 'Google',   purpose: 'only when you choose to sign in with Google' },
  { category: 'Map tiles',      name: 'OpenStreetMap', purpose: 'serves map images; receives your device IP when a map loads' },
]

/** "Contact: email · address" or just the address when no email is set. */
export function contactLine(): string {
  return CONTACT_EMAIL ? `${CONTACT_EMAIL} · ${MAILING_ADDRESS}` : MAILING_ADDRESS
}

/** Markdown-ready contact phrase for the legal pages. */
function contactPhrase(): string {
  return CONTACT_EMAIL
    ? `by email at ${CONTACT_EMAIL}, or by mail at ${MAILING_ADDRESS}`
    : `by mail at ${MAILING_ADDRESS}`
}

function retentionPhrase(): string {
  return BACKUP_RETENTION_DAYS === null
    ? 'Copies in our database provider\'s backups are purged on its standard backup rotation after that.'
    : `Residual copies in encrypted daily backups purge within a further ${BACKUP_RETENTION_DAYS} days.`
}

function processorList(): string {
  return PROCESSORS.map(p => `- **${p.category}** — ${p.name}: ${p.purpose}.`).join('\n')
}

/** Fill the {{TOKENS}} in content/*.md from these constants. */
export function fillLegal(md: string): string {
  return md
    .replaceAll('{{OPERATOR}}', OPERATOR)
    .replaceAll('{{OPERATOR_NAME}}', OPERATOR_NAME)
    .replaceAll('{{CONTACT}}', contactPhrase())
    .replaceAll('{{ADDRESS}}', MAILING_ADDRESS)
    .replaceAll('{{BACKUP_RETENTION}}', retentionPhrase())
    .replaceAll('{{PROCESSORS}}', processorList())
}
