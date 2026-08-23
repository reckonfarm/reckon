// READ-ONLY: projected sweep if the cutting-hop rule were TIME-based
// (paint hops with dt ≤ 60 s and d ≤ 200 m) instead of distance-only (≤25 m).
// Transit hops run minutes (162–273 s today) — cleanly excluded by dt.
// Validation across ALL known ground; nothing changed in lib.
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())
import { createClient } from '@supabase/supabase-js'
import { computeFieldBoundaries, pointInPolygon, distToRing, distToSegment, projectXY, meanLat, ACRE_M2, type Pt } from '../lib/jobs/boundary'
import type { TrackPoint } from '../lib/jobs/derive'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

function sweepWith(track: TrackPoint[], polygon: { lat: number; lng: number }[], rule: 'dist25' | 'dt60') {
  const lat0 = meanLat(track)
  const ring = projectXY(polygon, lat0)
  const xy = projectXY(track, lat0).map((p, i) => ({ ...p, t: track[i].t }))
  const cell = 2.5
  const r = 4.9 / 2
  const minX = Math.min(...ring.map(p => p.x)) - r - cell
  const maxX = Math.max(...ring.map(p => p.x)) + r + cell
  const minY = Math.min(...ring.map(p => p.y)) - r - cell
  const maxY = Math.max(...ring.map(p => p.y)) + r + cell
  const cols = Math.ceil((maxX - minX) / cell)
  const rows = Math.ceil((maxY - minY) / cell)
  const inside = new Uint8Array(cols * rows)
  let boundaryCells = 0
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const c: Pt = { x: minX + (cx + 0.5) * cell, y: minY + (cy + 0.5) * cell }
    if (pointInPolygon(c, ring) || distToRing(c, ring) <= r) { inside[cy * cols + cx] = 1; boundaryCells++ }
  }
  const swept = new Uint8Array(cols * rows)
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1], b = xy[i]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    const dt = b.t - a.t
    const cutting = rule === 'dist25' ? d <= 25 : d <= 200 && dt <= 60
    if (!cutting) continue
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - minX) / cell))
    const x1 = Math.min(cols - 1, Math.floor((Math.max(a.x, b.x) + r - minX) / cell))
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r - minY) / cell))
    const y1 = Math.min(rows - 1, Math.floor((Math.max(a.y, b.y) + r - minY) / cell))
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const k = cy * cols + cx
      if (swept[k]) continue
      const c: Pt = { x: minX + (cx + 0.5) * cell, y: minY + (cy + 0.5) * cell }
      if (distToSegment(c, a, b) <= r) swept[k] = 1
    }
  }
  let sweptInside = 0
  for (let k = 0; k < swept.length; k++) if (swept[k] && inside[k]) sweptInside++
  return { frac: sweptInside / boundaryCells, cutAc: (sweptInside * cell * cell) / ACRE_M2 }
}

async function run() {
  const CASES: [string, number, boolean][] = [
    ['Aug 10 (ground truth: visibly ~35% cut at job end)', 11163, false],
    ['Aug 23', 11498, true],
  ]
  for (const [label, seqStart, multi] of CASES) {
    const { data: jobs } = await db.from('jobs').select('track').eq('hardware_id', '14c19f3534f0').eq('seq_start', seqStart)
    const track = jobs![0].track as TrackPoint[]
    const fields = computeFieldBoundaries(track, multi)
    console.log(`\n${label}:`)
    for (const f of fields) {
      if (f.boundary.polygon == null || (f.boundary.status !== 'confirmed' && f.boundary.status !== 'estimate')) continue
      const old = sweepWith(f.track, f.boundary.polygon, 'dist25')
      const neu = sweepWith(f.track, f.boundary.polygon, 'dt60')
      console.log(`  field ${f.index}: dist≤25 rule ${(old.frac * 100).toFixed(1)}% (${old.cutAc.toFixed(2)} ac cut)  →  dt≤60 rule ${(neu.frac * 100).toFixed(1)}% (${neu.cutAc.toFixed(2)} ac cut)`)
    }
  }
}
run().catch(e => { console.error(e); process.exit(1) })
