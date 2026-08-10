// Shared display formatting for job surfaces (/jobs, /jobs/[id]).
// All times render in ranch time (America/Denver) regardless of server TZ.

export const RANCH_TZ = 'America/Denver'

export function fmtDay(iso: string, style: 'short' | 'long' = 'short'): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: RANCH_TZ,
    weekday: style === 'long' ? 'long' : 'short',
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Ranch-day grouping key — 'en-CA' formats YYYY-MM-DD, so keys are stable and
// sortable, and the day boundary is midnight in Denver, not on the server.
export function dayKey(when: string | number): string {
  return new Date(when).toLocaleDateString('en-CA', { timeZone: RANCH_TZ })
}

// Today's ranch-day key. Date.now() lives here, not in render bodies
// (react-hooks/purity; same pattern as lib/barn-geo.ts).
export function todayKey(nowMs: number = Date.now()): string {
  return dayKey(nowMs)
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: RANCH_TZ, hour: 'numeric', minute: '2-digit',
  })
}

// "under a minute" — never "0 min": a single-impact job has zero span but it
// still happened.
export function fmtDuration(s: number): string {
  if (s < 60) return 'under a minute'
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (h === 0) return `${m} min`
  return `${h} h ${m} m`
}

// Acreage is approximate by nature (GPS scatter vs a ~5 m header), so it is
// always SPOKEN approximately: one decimal under 10 acres, whole above. The
// precise value exists only in the CLI report, never in the UI.
export function fmtAcres(acres: number): string {
  return acres < 10 ? acres.toFixed(1) : String(Math.round(acres))
}

// ETA speaks the same coarse dialect as percent-cut: 5-minute steps, hours
// split out past sixty. The caller supplies "about … left" framing.
export function fmtEtaMin(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// The finish time, as a clock — "done ~3:40". For someone deciding whether to
// push through or come in, the clock answers the real question (before dark?
// before the rain?) better than a countdown. Rounded to :05, ranch time,
// no am/pm — nobody wonders which side of noon their own afternoon is on.
export function fmtDoneAt(nowMs: number, etaMin: number): string {
  const step = 5 * 60 * 1000
  const doneMs = Math.round((nowMs + etaMin * 60 * 1000) / step) * step
  return new Date(doneMs).toLocaleTimeString('en-US', {
    timeZone: RANCH_TZ, hour: 'numeric', minute: '2-digit',
  }).replace(/\s?[AP]M$/i, '')
}

// "1 impact", "1,187 impacts" — count and noun agree, always.
export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}
