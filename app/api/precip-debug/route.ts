// ⚠️ TEMPORARY DEBUG ENDPOINT — REMOVE AFTER USE ⚠️
//
// Round 2: replays getPrecipNormal's EXACT call sequence for FIPS 30069,
// SEQUENTIALLY, with per-call timing — using the real ELEMS (incl. the 30-year
// normals join) and the real wide-area bbox geometry. Goal: isolate whether the
// normals element, the wide-area bbox-with-normals call, or total-time-vs-
// maxDuration is what makes the real path fail while a lone simple call returns
// 200. Mirrors lib/precip-normal.ts. Delete this route once captured.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ACIS_BASE = 'https://data.rcc-acis.org'
const PRISM_GRID = '21'
const ACIS_UA = 'Dryline/1.0 (+reckonfarm.com)'
const COVERAGE_FLOOR = 0.5
const CURRENT_MAX_AGE_DAYS = 10

// Real ELEMS — actual + 30-year normal (the join omitted in round 1).
const ELEMS = [{ name: 'pcpn' }, { name: 'pcpn', normal: '1' }]

// ─── geometry / parsing (mirror of precip-normal.ts) ──────────────────────────
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}
function bboxFor(lat: number, lon: number, miles: number): string {
  const dLat = miles / 69
  const dLon = miles / (69 * Math.cos((lat * Math.PI) / 180))
  return `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`
}
function addDaysISO(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

type AcisStn = { meta?: { uid?: number; name?: string; ll?: [number, number] }; data?: Array<[string, string]> }

interface Candidate {
  name: string; uid: number; distanceMiles: number
  actValid: number; total: number; hasNormals: boolean
  lastValid: string | null; inCounty: boolean
}
function buildCandidates(stations: AcisStn[], lat: number, lon: number, sdate: string, inCounty: boolean): Candidate[] {
  const out: Candidate[] = []
  for (const s of stations) {
    const uid = s.meta?.uid
    if (uid == null) continue
    const rows = s.data ?? []
    let latestValidIdx = -1, actValid = 0, hasNormals = false
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i]?.[0], n = rows[i]?.[1]
      if (a !== 'M' && a != null) { actValid++; latestValidIdx = i }
      if (n !== 'M' && n != null) hasNormals = true
    }
    const ll = s.meta?.ll
    const distanceMiles = ll ? Math.round(haversineMiles(lat, lon, ll[1], ll[0])) : 0
    out.push({
      name: s.meta?.name ?? 'Unknown', uid, distanceMiles, actValid,
      total: rows.length, hasNormals,
      lastValid: latestValidIdx >= 0 ? addDaysISO(sdate, latestValidIdx) : null, inCounty,
    })
  }
  return out
}
const isFull = (c: Candidate) => c.hasNormals && c.total > 0 && c.actValid >= Math.floor(c.total * COVERAGE_FLOOR)
function isCurrent(c: Candidate, today: number): boolean {
  if (!c.lastValid) return false
  return (today - Date.parse(`${c.lastValid}T00:00:00Z`)) / 86_400_000 <= CURRENT_MAX_AGE_DAYS
}
function pickNearestCurrentFull(cands: Candidate[], today: number): Candidate | null {
  const ok = cands.filter(c => isFull(c) && isCurrent(c, today))
  if (!ok.length) return null
  const inC = ok.filter(c => c.inCounty)
  return (inC.length ? inC : ok).sort((a, b) => a.distanceMiles - b.distanceMiles)[0]
}
function pickNearestFull(cands: Candidate[]): Candidate | null {
  const ok = cands.filter(isFull)
  if (!ok.length) return null
  const inC = ok.filter(c => c.inCounty)
  return (inC.length ? inC : ok).sort((a, b) => a.distanceMiles - b.distanceMiles)[0]
}

// ─── instrumented ACIS POST ───────────────────────────────────────────────────
interface CallResult {
  label: string
  status: number | null
  statusText: string | null
  ms: number
  bytes: number | null
  stationCount: number | null
  threw: { name: string; message: string; looksLikeAbort: boolean } | null
}

async function timedPost(label: string, endpoint: string, body: Record<string, unknown>, countStations: boolean): Promise<{ result: CallResult; json: unknown }> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${ACIS_BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ACIS_UA },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const text = await res.text()
    const ms = Date.now() - t0
    let json: unknown = null
    let stationCount: number | null = null
    try {
      json = JSON.parse(text)
      if (countStations) stationCount = (json as { data?: unknown[] }).data?.length ?? 0
    } catch { /* leave json null; bytes/snippet still inform */ }
    return {
      result: { label, status: res.status, statusText: res.statusText, ms, bytes: text.length, stationCount, threw: null },
      json,
    }
  } catch (e) {
    const ms = Date.now() - t0
    const name = e instanceof Error ? e.name : 'Unknown'
    const message = e instanceof Error ? e.message : String(e)
    const looksLikeAbort = /abort|timeout|timed out|ETIMEDOUT|UND_ERR|terminated|socket/i.test(`${name} ${message}`)
    return {
      result: { label, status: null, statusText: null, ms, bytes: null, stationCount: null, threw: { name, message, looksLikeAbort } },
      json: null,
    }
  }
}

const multiBody = (area: Record<string, unknown>) => ({ ...area, meta: ['uid', 'name', 'll'], elems: ELEMS, output: 'json' })

export async function GET() {
  const seqStart = Date.now()
  const calls: CallResult[] = []

  // County coords exactly as the dashboard sources them.
  let lat = 47.116, lon = -108.250, coordSource = 'fallback'
  try {
    const db = createServiceClient()
    const { data } = await db.from('counties').select('lat, lon').eq('fips', '30069').single()
    if (data?.lat != null && data?.lon != null) { lat = data.lat; lon = data.lon; coordSource = 'db' }
  } catch { /* keep fallback */ }

  const today = new Date()
  const edate = new Date(today); edate.setDate(today.getDate() - 4)
  const sdate = `${today.getFullYear()}-01-01`
  const edateStr = edate.toISOString().slice(0, 10)
  const nowMs = Date.now()

  // 1. county
  const county = await timedPost('county MultiStnData (normals)', 'MultiStnData', multiBody({ county: '30069' }), true)
  calls.push(county.result)
  let cands = buildCandidates(((county.json as { data?: AcisStn[] })?.data) ?? [], lat, lon, sdate, true)
  let primary = pickNearestCurrentFull(cands, nowMs)

  // 2. bbox 50 / 100 / 150 — run ALL three (Petroleum has no in-county current-full)
  const seen = new Set(cands.map(c => c.uid))
  for (const d of [50, 100, 150]) {
    const ring = await timedPost(`bbox ${d}mi MultiStnData (normals)`, 'MultiStnData', multiBody({ bbox: bboxFor(lat, lon, d) }), true)
    calls.push(ring.result)
    const ringCands = buildCandidates(((ring.json as { data?: AcisStn[] })?.data) ?? [], lat, lon, sdate, false)
      .filter(c => c.distanceMiles <= d && !seen.has(c.uid))
    for (const c of ringCands) seen.add(c.uid)
    cands = cands.concat(ringCands)
    if (!primary) primary = pickNearestCurrentFull(cands, nowMs)
  }

  const normalStn = pickNearestFull(cands)
  const stnTarget = primary ?? normalStn

  // 3. StnData for the station the selection would use (with normals)
  if (stnTarget) {
    const stn = await timedPost(
      `StnData ${stnTarget.name} uid=${stnTarget.uid} (${primary ? 'primary' : 'failsafe-normal'})`,
      'StnData',
      { uid: stnTarget.uid, sdate, edate: edateStr, elems: ELEMS, output: 'json' },
      false,
    )
    calls.push(stn.result)
  }

  // 4. GridData failsafe
  const grid = await timedPost('GridData (PRISM failsafe)', 'GridData', {
    loc: `${lon},${lat}`, grid: PRISM_GRID, sdate, edate: edateStr,
    elems: [{ name: 'pcpn', interval: 'dly' }], output: 'json',
  }, false)
  calls.push(grid.result)

  const totalMs = Date.now() - seqStart

  return NextResponse.json({
    fips: '30069',
    coords: { lat, lon, source: coordSource },
    window: { sdate, edate: edateStr },
    selection: {
      primary: primary ? { name: primary.name, uid: primary.uid, distanceMiles: primary.distanceMiles, inCounty: primary.inCounty, lastValid: primary.lastValid } : null,
      failsafeNormalStn: normalStn ? { name: normalStn.name, uid: normalStn.uid, distanceMiles: normalStn.distanceMiles, inCounty: normalStn.inCounty } : null,
      candidateCount: cands.length,
    },
    calls,
    totalMs,
    maxDuration: {
      configured: null,
      note: 'No maxDuration in vercel.json or route segment config → Vercel platform default applies (Hobby ~10s, Pro ~15s default; configurable up to 60s/300s). Compare totalMs against your plan default — and note the REAL dashboard runs this sequence concurrently with ~15 other outbound fetches in one Promise.all, so wall-clock pressure is higher than totalMs here.',
    },
  })
}
