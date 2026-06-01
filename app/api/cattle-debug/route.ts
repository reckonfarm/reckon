// ⚠️ TEMPORARY DEBUG ENDPOINT — REMOVE AFTER WE CHOOSE THE DATA PATH ⚠️
//
// Runs THREE probes from Vercel's serverless environment so prod tells us why
// /cattle shows "data temporarily unavailable" while it worked in a local prod
// smoke test, and which data path is most durable:
//   A — current PDF path (fetch + pdfjs parse), instrumented
//   B — MARS API with the (possibly now-provisioned) key
//   C — structured, no-key endpoints for report 1778
// Always returns HTTP 200 JSON. Does not change parsing logic.

import { NextResponse } from 'next/server'
import { getCattleMarket } from '@/lib/cattle-market-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // don't let a platform timeout mask the real timing

const UA = 'Dryline/1.0 (+reckonfarm.com)'
const PDF_URL = 'https://www.ams.usda.gov/mnreports/ams_1778.pdf'

interface FetchProbe {
  label: string
  url: string
  httpStatus: number | null
  statusText: string | null
  ms: number
  bytes: number | null
  contentType: string | null
  parsedOk?: boolean
  bodySnippet?: string | null
  threw: { name: string; message: string } | null
  looksLikeTimeout: boolean
}

async function timedFetch(
  label: string,
  url: string,
  init: RequestInit,
  opts: { snippet?: boolean; json?: boolean; timeoutMs?: number } = {},
): Promise<{ probe: FetchProbe; buf: ArrayBuffer | null }> {
  const t0 = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 18000)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    const buf = await res.arrayBuffer()
    const ms = Date.now() - t0
    const ct = res.headers.get('content-type')
    let bodySnippet: string | null | undefined
    let parsedOk: boolean | undefined
    if (opts.snippet || opts.json) {
      const text = new TextDecoder().decode(buf.slice(0, 600))
      bodySnippet = text
      if (opts.json) {
        try { JSON.parse(new TextDecoder().decode(buf)); parsedOk = true } catch { parsedOk = false }
      }
    }
    return {
      probe: {
        label, url, httpStatus: res.status, statusText: res.statusText, ms,
        bytes: buf.byteLength, contentType: ct, parsedOk, bodySnippet, threw: null, looksLikeTimeout: false,
      },
      buf,
    }
  } catch (e) {
    const ms = Date.now() - t0
    const name = e instanceof Error ? e.name : 'Unknown'
    const message = e instanceof Error ? e.message : String(e)
    return {
      probe: {
        label, url, httpStatus: null, statusText: null, ms, bytes: null, contentType: null,
        threw: { name, message }, looksLikeTimeout: /abort|timeout|timed out|ETIMEDOUT|UND_ERR/i.test(`${name} ${message}`),
      },
      buf: null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

// Minimal copy of the parser's row reconstruction — ONLY to count what pdfjs sees
// in the serverless runtime. Not the production parse path.
const DATA_ROW = /^(\d{1,4})\s+(\d{2,4}(?:-\d{2,4})?)\s+(\d{2,4})\s+(\d{1,4}(?:\.\d{2})?(?:-\d{1,4}(?:\.\d{2})?)?)\s+(\d{1,4}\.\d{2})(?:\s+.+)?$/

async function pdfjsProbe(buf: ArrayBuffer) {
  const out: {
    pdfjsLoaded: boolean
    numPages: number | null
    textItems: number
    lines: number
    dataRowMatches: number
    threw: { name: string; message: string } | null
  } = { pdfjsLoaded: false, numPages: null, textItems: 0, lines: 0, dataRowMatches: 0, threw: null }
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    out.pdfjsLoaded = true
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false }).promise
    out.numPages = doc.numPages
    const lines: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent()
      out.textItems += tc.items.length
      const rows = new Map<number, Array<{ x: number; s: string }>>()
      for (const it of tc.items as Array<{ str?: string; transform?: number[] }>) {
        if (!it.str || !it.transform) continue
        const y = Math.round(it.transform[5])
        ;(rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str })
      }
      for (const [, cells] of rows) {
        const line = cells.sort((a, b) => a.x - b.x).map(c => c.s).join(' ').replace(/\s+/g, ' ').trim()
        if (line) { lines.push(line); if (DATA_ROW.test(line)) out.dataRowMatches++ }
      }
    }
    out.lines = lines.length
  } catch (e) {
    out.threw = { name: e instanceof Error ? e.name : 'Unknown', message: e instanceof Error ? e.message : String(e) }
  }
  return out
}

export async function GET() {
  // ── PROBE A: current PDF path ─────────────────────────────────────────────────
  const pdfFetch = await timedFetch('PDF report 1778', PDF_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/pdf' },
  }, { snippet: true })
  const pdfParse = pdfFetch.buf ? await pdfjsProbe(pdfFetch.buf) : null

  // The real production outcome (cached) — what the page actually sees.
  let serviceOutcome: Record<string, unknown>
  try {
    const m = await getCattleMarket()
    serviceOutcome = {
      status: m.status, mode: m.mode, asOf: m.asOf,
      steerClasses: m.feeder.steers.length, heiferClasses: m.feeder.heifers.length,
      cullCows: m.cullCows != null, slaughterBulls: m.slaughterBulls != null,
      receiptsCurrent: m.receipts.current,
    }
  } catch (e) {
    serviceOutcome = { threw: e instanceof Error ? e.message : String(e) }
  }

  const probeA = {
    fetch: pdfFetch.probe,
    pdfjs: pdfParse,
    serviceOutcome,
    reason:
      pdfFetch.probe.threw ? `fetch ${pdfFetch.probe.looksLikeTimeout ? 'timed out' : 'threw'}: ${pdfFetch.probe.threw.message}`
      : pdfFetch.probe.httpStatus !== 200 ? `fetch non-200 (${pdfFetch.probe.httpStatus})`
      : !pdfParse ? 'no buffer to parse'
      : pdfParse.threw ? `pdfjs threw: ${pdfParse.threw.message}`
      : !pdfParse.pdfjsLoaded ? 'pdfjs failed to load in serverless runtime'
      : pdfParse.dataRowMatches === 0 ? 'pdfjs loaded but parsed 0 data rows'
      : 'PDF path looks healthy from this probe',
  }

  // ── PROBE B: MARS API key re-test ──────────────────────────────────────────────
  const key = process.env.AMS_MARS_API_KEY
  let probeB: Record<string, unknown>
  if (!key) {
    probeB = { keyPresentInEnv: false, note: 'AMS_MARS_API_KEY is NOT set in this (Vercel) environment — likely only in local .env.local.' }
  } else {
    const auth = Buffer.from(`${key}:`).toString('base64')
    const r = await timedFetch('MARS v1.2 report 1778', 'https://marsapi.ams.usda.gov/services/v1.2/reports/1778', {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'User-Agent': UA },
    }, { snippet: true, json: true })
    probeB = {
      keyPresentInEnv: true, keyLength: key.length,
      ...r.probe,
      returnedStructuredData: r.probe.parsedOk === true && (r.probe.httpStatus ?? 0) >= 200 && (r.probe.httpStatus ?? 0) < 300,
    }
  }

  // ── PROBE C: structured no-key endpoints ───────────────────────────────────────
  const cTargets: Array<[string, string]> = [
    ['mymarketnews v1.2 (no auth)', 'https://mymarketnews.ams.usda.gov/services/v1.2/reports/1778'],
    ['mymarketnews v1.1 (no auth)', 'https://mymarketnews.ams.usda.gov/services/v1.1/reports/1778'],
    ['public filerepo report', 'https://mymarketnews.ams.usda.gov/public/filerepo/report?reportId=1778&fileTypeKey=2'],
    ['legacy TXT slug', 'https://www.ams.usda.gov/mnreports/ams_1778.txt'],
    ['marketnews ls-report', 'https://marketnews.usda.gov/mnp/ls-report?runReport=true&reportId=1778'],
  ]
  const probeC: FetchProbe[] = []
  for (const [label, url] of cTargets) {
    const r = await timedFetch(label, url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' } }, { json: true, timeoutMs: 12000 })
    probeC.push(r.probe)
  }

  return NextResponse.json({
    now: new Date().toISOString(),
    probeA_pdf: probeA,
    probeB_mars: probeB,
    probeC_structured: probeC,
  })
}
