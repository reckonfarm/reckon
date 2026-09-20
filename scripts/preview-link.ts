// ─── One tap into a preview, signed in as you ────────────────────────────────
//
//   BASE=https://<preview>.vercel.app npx tsx scripts/preview-link.ts
//
// Prints ONE link. Tapping it on the phone gets past Vercel's protection and
// lands signed in as PK on that preview — no typing, no bypass header to set,
// no magic-link email to wait for.
//
// It is built from what already exists: the same admin.generateLink the suites
// sign in with, and the same VERCEL_BYPASS token they send as a header, put in
// the query string instead because a phone cannot set a header.
//
// WHAT IT REFUSES, and these are not negotiable:
//   · production — a one-tap sign-in link to the live ranch is not a thing
//     that should exist, so any host that is not a Vercel preview is refused;
//   · a deployment that is not serving — the link would land on a 404 or on
//     Vercel's login page, which is worse than no link;
//   · an account that is not on this database — a typo in the email would
//     otherwise mint a working link for a stranger.
//
// The auth token is single-use and expires the way Supabase's magic links do.
// The bypass token in the URL is NOT short-lived: it is the project's
// automation secret, so the link is for PK's phone and not for anywhere it
// would be written down.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

for (const f of ['.env', '.env.local', 'e2e/.env.e2e']) {
  const p = resolve(process.cwd(), f)
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const BASE = (process.env.BASE ?? '').replace(/\/$/, '')
const BYPASS = process.env.VERCEL_BYPASS
const NEXT = process.env.LINK_NEXT ?? '/today'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

function die(why: string): never {
  console.error(`preview-link: ${why}`)
  process.exit(1)
}

const gitEmail = () => { try { return execSync('git config user.email', { encoding: 'utf8' }).trim() } catch { return '' } }
const EMAIL = process.env.LINK_EMAIL || gitEmail()

async function main() {
  if (!BASE) die('BASE is not set — give it the preview URL.')
  if (!URL_ || !SERVICE) die('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local.')
  if (!EMAIL) die('no account to sign in as — set LINK_EMAIL, or a git user.email.')

  // 1. Never production. A preview is a vercel.app host and nothing else is.
  const host = (() => { try { return new globalThis.URL(BASE).host } catch { return '' } })()
  if (!host) die(`BASE is not a URL: ${BASE}`)
  if (!host.endsWith('.vercel.app')) {
    die(`refusing ${host} — this mints a one-tap sign-in and only ever points at a preview, never production.`)
  }
  if (!BYPASS) die('VERCEL_BYPASS is missing from e2e/.env.e2e — without it the link lands on Vercel\'s login page.')

  // 2. The deployment has to be serving OUR app, or the link is worthless.
  //    Same proof scripts/preview-ready.ts uses: the sign-in page, and a marker
  //    a Vercel error or protection page does not have.
  const probe = await fetch(`${BASE}/signin`, { headers: { 'x-vercel-protection-bypass': BYPASS } }).catch(() => null)
  const body = probe ? await probe.text() : ''
  if (!probe || probe.status !== 200 || !/Dryline/i.test(body)) {
    die(`${BASE} is not serving the app (${probe ? `HTTP ${probe.status}` : 'no answer'}) — nothing to sign in to.`)
  }

  // 3. The account has to exist here, or the link would be for nobody.
  const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (!(users?.users ?? []).some(u => (u.email ?? '').toLowerCase() === EMAIL.toLowerCase())) {
    die(`${EMAIL} is not an account on this database — check LINK_EMAIL.`)
  }

  // 4. The same magic link the suites sign in with, single-use and expiring.
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const tokenHash = link.data?.properties?.hashed_token
  if (!tokenHash) die(`generateLink: ${link.error?.message ?? 'no token'}`)

  // The bypass goes in the QUERY STRING: a phone cannot set a header, and
  // set-bypass-cookie makes the rest of the session work without it.
  const url = `${BASE}/auth/callback?token_hash=${tokenHash}&type=magiclink&next=${encodeURIComponent(NEXT)}`
    + `&x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=true`

  console.log(url)
  console.error(`\n(one tap, signs in as ${EMAIL} on ${host}, lands on ${NEXT} — single use, expires)`)
}

main().catch(e => die(e instanceof Error ? e.message : String(e)))
