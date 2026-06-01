// Shared drought-severity descriptor used by the cattle page's market read and by
// the Share affordance on both dashboards. Derives a single headline D-level from a
// USDM weekly reading (d0–d4 are CUMULATIVE — "Dn or worse"), picking the most
// severe category with ≥5% area coverage. UI/labeling only — not LFP eligibility.

export interface DroughtSeverity {
  level: number | null   // 0–4, or null when not in drought / no data
  label: string          // e.g. "D2 (severe drought)" or "not currently in drought"
  severityWord: string   // e.g. "severe drought" ('' when not in drought)
}

export interface UsdmReading {
  d0: number | null
  d1: number | null
  d2: number | null
  d3: number | null
  d4: number | null
}

const SEVERITY_WORD: Record<number, string> = {
  4: 'exceptional drought',
  3: 'extreme drought',
  2: 'severe drought',
  1: 'moderate drought',
  0: 'abnormally dry',
}

export function droughtSeverity(row: UsdmReading | null): DroughtSeverity {
  if (!row) return { level: null, label: 'not currently rated for drought', severityWord: '' }
  const vals: Array<[number, number]> = [
    [4, row.d4 ?? 0], [3, row.d3 ?? 0], [2, row.d2 ?? 0], [1, row.d1 ?? 0], [0, row.d0 ?? 0],
  ]
  const worst = vals.find(([, pct]) => pct >= 5)
  if (!worst) return { level: null, label: 'not currently in drought', severityWord: '' }
  const n = worst[0]
  return { level: n, label: `D${n} (${SEVERITY_WORD[n]})`, severityWord: SEVERITY_WORD[n] }
}
