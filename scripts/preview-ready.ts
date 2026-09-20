// ─── Is this deployment actually serving our app? ────────────────────────────
//
// DOCTRINE: a check proves what it is looking at before it reads anything from
// it. A readiness gate is the first check of any run and it has been wrong
// three times: it asked a page that does not exist (`/auth/sign-in` — 404 on
// production too, the real path is `/signin`), it accepted a 404 from a
// preview alias Vercel had never built, and it read JavaScript out of a 404
// page's chunks and concluded a deploy had not landed.
//
// So this asserts IDENTITY, not existence:
//   · the sign-in page answers 200 — the path a suite actually signs in through;
//   · the HTML is OURS, not a Vercel error page, proven by a marker only this
//     app serves;
//   · and it says which host it proved, so a run cannot claim one and use
//     another.
//
//   BASE=https://<preview>.vercel.app npx tsx scripts/preview-ready.ts
//
// Exits 0 when the deployment serves the app, 1 with the reason when it does
// not. Reads nothing else and writes nothing.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

for (const f of ['.env', '.env.local', 'e2e/.env.e2e']) {
  const p = resolve(process.cwd(), f)
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const BASE = process.env.BASE ?? 'https://www.dryline.farm'
const BYPASS = BASE.includes('vercel.app') ? process.env.VERCEL_BYPASS : undefined
const TRIES = Number(process.env.READY_TRIES ?? 60)
const EVERY_MS = 15_000

/** The page a suite signs in through. Not a guess: scripts/*.ts use it. */
const SIGN_IN = '/signin'
/**
 * Proof the page is OURS. Checked against the real thing and against what
 * stands in its place: Vercel's protection page is titled "Login – Vercel",
 * is 340 KB, answers 200, and contains no "Dryline" anywhere — so it passes a
 * status check and fails this one, which is the whole point.
 */
const MARKER = /Dryline/i
const NOT_OURS = /Login\s*[–-]\s*Vercel/i

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function main() {
  let last = 'never answered'
  for (let i = 1; i <= TRIES; i++) {
    try {
      // The bypass TOKEN only. Never `x-vercel-set-bypass-cookie` here: that
      // asks Vercel to set a cookie and redirect, and this client keeps no
      // cookies, so it redirects until the limit and reports "fetch failed" —
      // a dead deployment, indistinguishable from a real one, six times out of
      // six. The suites may send it because Playwright holds the cookie. A
      // header copied from a client that can honour it into one that cannot is
      // the same mistake as reading a page whose identity was never checked.
      const res = await fetch(`${BASE}${SIGN_IN}`, {
        redirect: 'follow',
        headers: BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {},
      })
      const body = await res.text()
      const title = (/<title>([^<]*)<\/title>/.exec(body) ?? [, ''])[1].trim()
      if (res.status === 200 && MARKER.test(body) && !NOT_OURS.test(body)) {
        console.log(`preview-ready: ${BASE}${SIGN_IN} serves the app — 200, "${title}", ${body.length} bytes, after ${i} ${i === 1 ? 'try' : 'tries'}`)
        process.exit(0)
      }
      last = res.status !== 200
        ? `HTTP ${res.status}`
        : NOT_OURS.test(body)
        ? `200 but this is Vercel's protection page ("${title}") — the bypass token is missing or wrong`
        : `200 but the page is not ours ("${title}", ${body.length} bytes)`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    if (i < TRIES) await sleep(EVERY_MS)
  }
  console.error(`preview-ready: ${BASE} is NOT serving the app — ${last}. Nothing was run.`)
  process.exit(1)
}

main()
