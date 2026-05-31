// ⚠️ TEMPORARY DEBUG ENDPOINT — REMOVE AFTER USE ⚠️
//
// Surfaces exactly what ACIS (data.rcc-acis.org) returns to Vercel's serverless
// egress, so we can read the rejection (403/429/503 + CDN/WAF markers) directly
// from the HTTP response instead of the Vercel function logs. One server-side
// fetch, mirroring lib/precip-normal.ts's acisPost (same UA). Delete this route
// once the ACIS egress status is captured.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ACIS_UA = 'Dryline/1.0 (+reckonfarm.com)'

// Headers worth surfacing: CDN/WAF/edge markers that reveal a Cloudflare/Akamai
// challenge or an IP/WAF block, plus rate-limit signaling.
const HEADERS_OF_INTEREST = [
  'server',
  'cf-ray',
  'cf-mitigated',
  'cf-cache-status',
  'retry-after',
  'via',
  'x-vercel-id',
  'x-amz-cf-id',
  'x-cache',
  'x-served-by',
  'content-type',
  'content-length',
  'age',
  'date',
]

export async function GET() {
  const body = {
    county: '30069',
    meta: ['uid', 'name', 'll'],
    elems: [{ name: 'pcpn', interval: 'dly' }],
    sdate: '2026-01-01',
    edate: '2026-05-26',
    output: 'json',
  }

  try {
    const res = await fetch('https://data.rcc-acis.org/MultiStnData', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ACIS_UA },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    // Read raw text first — a Cloudflare/Akamai challenge or "Access Denied"
    // page is HTML and would otherwise blow up res.json().
    const text = await res.text()

    const responseHeaders: Record<string, string | null> = {}
    for (const h of HEADERS_OF_INTEREST) responseHeaders[h] = res.headers.get(h)
    // Also dump any header whose name hints at a CDN/WAF we didn't list.
    const extra: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      if (/^cf-|^x-(amz|akamai|sucuri|waf)|mitigat|challenge|ratelimit|rate-limit/i.test(key)) {
        extra[key] = value
      }
    })

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      responseHeaders,
      extraSecurityHeaders: extra,
      bodyLength: text.length,
      bodySnippet: text.slice(0, 400),
      threw: null,
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      status: null,
      statusText: null,
      responseHeaders: null,
      extraSecurityHeaders: null,
      bodyLength: null,
      bodySnippet: null,
      threw: {
        name: e instanceof Error ? e.name : 'Unknown',
        message: e instanceof Error ? e.message : String(e),
      },
    })
  }
}
