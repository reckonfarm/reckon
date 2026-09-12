import {
  CAPTURE_CONFIG, MAX_ACCURACY_M, GAP_AFTER_S, SETTLE_RUNS,
  hasSettled, settledRun, isOutlier, gapsIn, rideBoundary, closeByHand,
  averagePosition, rideOutcome, metresBetween, TOO_SMALL_M2, type CaptureFix,
} from '../lib/places/capture'
import { ACRE_M2, MAX_LOOP_SELF_CROSSINGS } from '../lib/jobs/boundary'
import { validateGeoJSONPolygon } from '../lib/places/geo'

// ─── Block 8 capture harness — the profile, proved before any UI ──────────────
// Synthetic rides built from PK's measured numbers (1 Hz, ±2.1 m median), run
// through the SAME computeFieldBoundary the swather uses. A self-checking CLI,
// the bale-detector convention: nonzero exit on any failure.

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const M_PER_LAT = 111_132
const LAT0 = 47.0, LNG0 = -108.2
const mPerLng = 111_320 * Math.cos((LAT0 * Math.PI) / 180)

/** A rectangle ridden at 8 m/s with 1 Hz fixes and gaussian-ish scatter. */
function ride(widthM: number, heightM: number, opts: { acc?: number; jitter?: number; closeGapM?: number; startT?: number; speed?: number } = {}): CaptureFix[] {
  const acc = opts.acc ?? 2.1, jitter = opts.jitter ?? 1.2
  // speed in m/s at 1 Hz — so it is also the metres between fixes. 8 is PK's
  // measured riding speed; a slow walk round a corral is 1.
  const speed = opts.speed ?? 8, step = speed
  const corners = [[0, 0], [widthM, 0], [widthM, heightM], [0, heightM], [0, 0]]
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < corners.length - 1; i++) {
    const [x0, y0] = corners[i], [x1, y1] = corners[i + 1]
    const seg = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(seg / step))
    for (let k = 0; k < n; k++) pts.push({ x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n })
  }
  // Stop short of the start by closeGapM when asked (an unclosed ride).
  if (opts.closeGapM) pts.splice(Math.max(1, pts.length - Math.round(opts.closeGapM / step)))
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5 }
  const t0 = opts.startT ?? Date.now()
  return pts.map((p, i) => ({
    t: t0 + i * 1000,
    lat: LAT0 + (p.y + rnd() * jitter) / M_PER_LAT,
    lng: LNG0 + (p.x + rnd() * jitter) / mPerLng,
    acc,
  }))
}

console.log('\nBlock 8 — capture profile harness\n')

// 1 — the profile is the swather's geometry with the phone's numbers
check('profile: the guards that cannot apply are off, not retuned',
  CAPTURE_CONFIG.headlandOutsideRatioMax === Number.POSITIVE_INFINITY && CAPTURE_CONFIG.secondPassMinShare === 0,
  `headland ${CAPTURE_CONFIG.headlandOutsideRatioMax} · secondPass ${CAPTURE_CONFIG.secondPassMinShare}`)
check('profile: closure tolerance is 2× the measured p90, and leave is 2× that',
  CAPTURE_CONFIG.closureEpsM === 10 && CAPTURE_CONFIG.leaveMinM === 20,
  `eps ${CAPTURE_CONFIG.closureEpsM} · leave ${CAPTURE_CONFIG.leaveMinM}`)

// 2 — a ridden field closes and measures true
{
  const truthM2 = 400 * 300
  const r = rideBoundary(ride(400, 300))
  const acres = r.boundary.acres ?? 0
  const errPct = Math.abs((r.boundary.areaM2 ?? 0) - truthM2) / truthM2 * 100
  check('a 400 × 300 m ride ties and grades confirmed',
    r.boundary.status === 'confirmed', `status ${r.boundary.status} · reasons [${r.boundary.estimateReasons.join(',')}]`)
  check('its acreage is within 2% of the true rectangle',
    errPct < 2, `${acres.toFixed(2)} ac vs ${(truthM2 / ACRE_M2).toFixed(2)} ac · ${errPct.toFixed(2)}% off`)
}

// 3 — a ride that stops short SNAPS, and the place says so (PK's note 1)
{
  // Truncate until the end sits BETWEEN the tie tolerance and the snap
  // tolerance — the only window in which a snap can happen at all. Built by
  // measurement rather than by guessing how many points to drop.
  const full = ride(400, 300, { speed: 2 })
  let fixes = full
  for (let n = 1; n < full.length; n++) {
    const cut = full.slice(0, full.length - n)
    const d = metresBetween(cut[cut.length - 1], cut[0])
    if (d > CAPTURE_CONFIG.closureEpsM && d < CAPTURE_CONFIG.snapClosureM) { fixes = cut; break }
  }
  const gap = metresBetween(fixes[fixes.length - 1], fixes[0])
  const r = rideBoundary(fixes)
  const o = rideOutcome(r, fixes)
  console.log(`      (ride truncated to a ${gap.toFixed(1)} m gap — between eps ${CAPTURE_CONFIG.closureEpsM} and snap ${CAPTURE_CONFIG.snapClosureM})`)
  check('a ride that stops short closes on the GUESS, grades estimate, and says which',
    r.boundary.snapped && r.boundary.estimateReasons.includes('snapped') && o.kind === 'snapped' && /not a true tie/.test(o.message),
    `${o.kind} · closure ${(r.boundary.closureDistM ?? 0).toFixed(1)} m · "${o.message.slice(0, 52)}…"`)
}

// 4 — the pen minTrackPoints used to make impossible at riding speed
{
  const fixes = ride(30, 30)
  const r = rideBoundary(fixes)
  check('a 30 × 30 m pen closes now that minTrackPoints is 12, not the inherited 30',
    r.boundary.polygon !== null, `${fixes.length} fixes · status ${r.boundary.status} · ${(r.boundary.acres ?? 0).toFixed(3)} ac`)
}

// 5 — the two floors fail DIFFERENTLY, and both hand over the right tool
{
  const small = ride(14, 14, { jitter: 0.3, speed: 1 })   // walked: plenty of fixes, too little ground
  const os = rideOutcome(rideBoundary(small), small)
  check('too little ground says so in m², and offers to drop a point instead',
    os.kind === 'too_small' && os.offerDrop && /drop a point/.test(os.message),
    `${small.length} fixes · ${os.kind} · "${os.message.slice(0, 60)}…"`)

  const brief = ride(400, 300).slice(0, 8)              // plenty of ground, barely ridden
  const ob = rideOutcome(rideBoundary(brief), brief)
  check('too little RIDING says so separately, and says ride slower',
    ob.kind === 'too_short' && ob.offerDrop && /slower/.test(ob.message),
    `${brief.length} fixes · ${ob.kind} · "${ob.message.slice(0, 60)}…"`)

  const open = ride(400, 300, { closeGapM: 200 })
  const oo = rideOutcome(rideBoundary(open), open)
  check('a ride that never returns says to keep riding or Finish here — it does not offer a point',
    oo.kind === 'open' && !oo.offerDrop && /Finish here/.test(oo.message),
    `${oo.kind} · "${oo.message.slice(0, 60)}…"`)
}

// 6 — the outlier is rejected and counted, never silently dropped
{
  const fixes = ride(400, 300)
  fixes[40] = { ...fixes[40], acc: 503.8, lat: fixes[40].lat + 0.004 }
  const r = rideBoundary(fixes)
  check('the 503 m fix is rejected and COUNTED, and the boundary still ties',
    r.rejected === 1 && r.boundary.status === 'confirmed',
    `rejected ${r.rejected} · status ${r.boundary.status}`)
  check('a fix at exactly the threshold is kept, one above it is not',
    !isOutlier({ t: 0, lat: 0, lng: 0, acc: MAX_ACCURACY_M }) && isOutlier({ t: 0, lat: 0, lng: 0, acc: MAX_ACCURACY_M + 0.1 }),
    `threshold ${MAX_ACCURACY_M} m`)
}

// 7 — the settle gate, against PK's two runs
{
  const cold = [13.0, 27.2, 76.8, 9.4, 12.1, 6.2, 8.8].map((acc, i) => ({ t: i * 1000, lat: LAT0, lng: LNG0, acc }))
  const warm = Array.from({ length: 8 }, (_, i) => ({ t: i * 1000, lat: LAT0, lng: LNG0, acc: 2.1 }))
  check('a cold receiver never settles on run 1\'s numbers', !hasSettled(cold), `run of ${settledRun(cold)} / ${SETTLE_RUNS}`)
  check('a warm receiver settles on run 2\'s numbers', hasSettled(warm), `run of ${settledRun(warm)} / ${SETTLE_RUNS}`)
}

// 8 — the screen-lock gap is seen, and never bridged
{
  const a = ride(400, 300)
  const half = Math.floor(a.length / 2)
  for (let i = half; i < a.length; i++) a[i] = { ...a[i], t: a[i].t + 48_000 }   // PK's 48 s
  const gs = gapsIn(a)
  check('a 48 s screen-lock gap is found and measured', gs.length === 1 && Math.round(gs[0].seconds) === 49,
    `${gs.length} gap(s) · ${gs[0] ? gs[0].seconds.toFixed(0) : '—'} s · threshold ${GAP_AFTER_S} s`)
  const r = rideBoundary(a)
  check('the ride across the gap still measures, and the gap is reported with it',
    r.gaps.length === 1 && r.boundary.polygon !== null, `${r.gaps.length} gap(s) · status ${r.boundary.status}`)
}

// 9 — hand closure (8.3), and the crossing it can produce
{
  const open = ride(400, 300, { closeGapM: 120 })
  const byHand = closeByHand(open)
  check('an unclosable ride can be finished by hand and still measures',
    byHand.ok && byHand.acres > 5, byHand.ok ? `${byHand.acres.toFixed(2)} ac by hand` : `refused: ${byHand.error.slice(0, 50)}`)

  // A U-shaped ride: the straight line home cuts across the track. This is the
  // ordinary case — riding round a creek — and it is what put two
  // contradictory messages on one confirm screen with Save still enabled.
  const u: CaptureFix[] = []
  const t0 = Date.now()
  const leg = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 8))
    for (let k = 0; k < n; k++) u.push({
      t: t0 + u.length * 1000,
      lat: LAT0 + (y0 + ((y1 - y0) * k) / n) / M_PER_LAT,
      lng: LNG0 + (x0 + ((x1 - x0) * k) / n) / mPerLng,
      acc: 2.1,
    })
  }
  // Offsets chosen so the doubling-back leg CROSSES the first leg rather than
  // touching a vertex of it. segmentsCross counts proper crossings only —
  // collinear touches are GPS-noise overlaps on retraced ground — so a test
  // shape whose vertices land exactly on the line proves nothing. 300/38 × 19
  // is exactly 150, which is how the first two attempts at this shape passed.
  leg(0, 0, 300, 0); leg(300, 0, 300, 205); leg(300, 205, 151, 205)
  leg(151, 205, 151, -83); leg(151, -83, 40, -83)   // cuts back across the first leg
  const crossed = closeByHand(u)
  check('a hand closure that would fold the shape over is REFUSED, before Save is offered',
    !crossed.ok && crossed.reason === 'crossed',
    crossed.ok ? `WRONGLY ALLOWED — ${crossed.acres.toFixed(2)} ac` : `refused (${crossed.reason}): "${crossed.error.slice(0, 56)}…"`)

  // And the thing that made it a bug rather than a rejection: a ridden ring is
  // now judged at the driven-lap tolerance, not the tap-draw zero.
  const ridden = rideBoundary(ride(400, 300))
  const ring = ridden.boundary.polygon ? [...ridden.boundary.polygon, ridden.boundary.polygon[0]] : []
  const asDrawn = validateGeoJSONPolygon({ type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat])] }, 0)
  const asRidden = validateGeoJSONPolygon({ type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat])] }, MAX_LOOP_SELF_CROSSINGS)
  check('a ridden ring is validated at the driven-lap tolerance, and the save accepts what the geometry blessed',
    asRidden.ok, `as ridden ${asRidden.ok ? 'ok' : asRidden.error.slice(0, 40)} · as tap-drawn ${asDrawn.ok ? 'ok' : 'refused'}`)
}

// 10 — 8.1's averaged drop
{
  const still = Array.from({ length: 6 }, (_, i) => ({ t: i * 1000, lat: LAT0 + (i % 2 ? 2 : -2) / M_PER_LAT, lng: LNG0, acc: i === 3 ? 1.9 : 3.4 }))
  const avg = averagePosition(still)
  const offM = avg ? Math.abs(avg.lat - LAT0) * M_PER_LAT : Infinity
  check('averaging six jittered fixes lands within a metre of the true spot',
    offM < 1, `${offM.toFixed(2)} m off · quoted ±${avg?.accM} m from ${avg?.used} fixes`)
  check('the quoted accuracy is the best fix averaged, not the mean or the worst',
    avg?.accM === 1.9, `±${avg?.accM} m`)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}\n`)
process.exit(failures ? 1 : 0)
