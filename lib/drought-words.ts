// ─── The Thursday alert, in words a person reads (Block 16, ruling 2) ─────────
//
// The alert names the U.S. Drought Monitor as its source, carries the valid
// date the release itself carries (the Tuesday the map is "valid" for — the
// same date drought_data stores as week_date and drought_observations as
// valid_through), and states the drought class in plain words. Nothing here
// says eligibility, tier, payment or LFP: that is FSA's determination and it
// lives on its own screen. The percentages are the USDM "traditional"
// statistics (statisticsType=1): d2 is the share of the county in D2 OR
// WORSE, which is why the sentence says "or worse".

export const USDM_WORDS = ['abnormally dry', 'moderate drought', 'severe drought', 'extreme drought', 'exceptional drought'] as const
export type UsdmLevel = 0 | 1 | 2 | 3 | 4

export interface UsdmReading { d0?: number | null; d1?: number | null; d2?: number | null; d3?: number | null; d4?: number | null }

/** The stored shape on the alert payload: the worst class with any coverage, and the cumulative shares. */
export interface UsdmSummary {
  level: UsdmLevel
  pct: number            // share of the county at this level or worse, whole percent
  d0: number; d1: number; d2: number; d3: number; d4: number
}

const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0)

export function summarizeUsdm(r: UsdmReading): UsdmSummary | null {
  const d = [pct(r.d0), pct(r.d1), pct(r.d2), pct(r.d3), pct(r.d4)]
  let worst = -1
  for (let l = 4; l >= 0; l--) if (d[l] > 0) { worst = l; break }
  if (worst < 0) return null
  return { level: worst as UsdmLevel, pct: Math.round(d[worst]), d0: Math.round(d[0]), d1: Math.round(d[1]), d2: Math.round(d[2]), d3: Math.round(d[3]), d4: Math.round(d[4]) }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Extreme drought (D3) across 12% of the county, severe drought or worse across 61%." */
export function droughtClassWords(s: UsdmSummary): string {
  const first = `${cap(USDM_WORDS[s.level])} (D${s.level}) across ${s.pct}% of the county`
  if (s.level === 0) return first
  const below = [s.d0, s.d1, s.d2, s.d3, s.d4][s.level - 1]
  return below > s.pct ? `${first}, ${USDM_WORDS[s.level - 1]} or worse across ${below}%` : first
}

export function fmtValidDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function readSummary(p: Record<string, unknown>): UsdmSummary | null {
  const u = p.usdm
  if (!u || typeof u !== 'object') return null
  const o = u as Record<string, unknown>
  const lvl = o.level
  if (typeof lvl !== 'number' || lvl < 0 || lvl > 4) return null
  return { level: lvl as UsdmLevel, pct: pct(o.pct), d0: pct(o.d0), d1: pct(o.d1), d2: pct(o.d2), d3: pct(o.d3), d4: pct(o.d4) }
}

/**
 * The one line every reader of the alert prints — Today's "since you
 * checked", the ranch record, the feed. Null when the payload cannot even
 * name a county: such a row is left out rather than shown as a bare word.
 */
export function droughtAlertLine(p: Record<string, unknown>): string | null {
  if (p.kind !== 'lfp_drought_alert' || typeof p.county_name !== 'string') return null
  const valid = typeof p.valid_date === 'string' ? p.valid_date : typeof p.week_date === 'string' ? p.week_date : null
  const when = valid ? ` · valid ${fmtValidDate(valid)}` : ''
  const s = readSummary(p)
  if (!s) return `U.S. Drought Monitor: ${p.county_name}${when} — the drought class was not kept on this alert`
  return `U.S. Drought Monitor: ${p.county_name} — ${droughtClassWords(s)}${when}`
}
