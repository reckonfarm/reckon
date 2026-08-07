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

// "1 impact", "1,187 impacts" — count and noun agree, always.
export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}
