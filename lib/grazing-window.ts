import { getGrazingPeriod } from './grazing-periods'
import type { GrazingPeriod } from './lfp-eligibility'

// ─── Default grazing-window resolver — single source of truth ──────────────────
//
// The DEFAULT FSA grazing window for a county, shared by every surface that needs it
// so the windows can never drift apart:
//   • the dashboard (current-year default view AND the prior-year comparison),
//   • the LFP snapshot capture (lib/lfp-snapshot.ts),
//   • the OG share card (app/dashboard/opengraph-image.tsx).
//
//   - pastureType: the dashboard's forage selector passes the chosen type; omitted
//     elsewhere, so getGrazingPeriod falls back to Native Pasture, then the first
//     forage type for the county.
//   - year: the calendar year the window opens (defaults to the current year). The
//     dashboard's prior-year comparison passes currentYear - 1.
//   - Counties absent from the FOIA dataset use the generic Northern Plains season.
//
// This is NOT the dashboard's gs/ge query-param override — that stays at the call site.
//
// The construction body below is byte-for-byte the logic that previously lived inline
// at each call site; only the `year` and `pastureType` inputs were ever different.

export function resolveDefaultGrazingWindow(
  fips: string,
  pastureType?: string,
  year: number = new Date().getFullYear(),
): GrazingPeriod {
  const period = getGrazingPeriod(fips, pastureType)
  if (period) {
    const startMM = parseInt(period.start.slice(0, 2), 10)
    const endMM   = parseInt(period.end.slice(0, 2), 10)
    const endYear = endMM < startMM ? year + 1 : year
    return { startDate: `${year}-${period.start}`, endDate: `${endYear}-${period.end}` }
  }
  // Generic Northern Plains fallback for counties not in the FOIA dataset.
  return { startDate: `${year}-05-01`, endDate: `${year}-11-30` }
}
