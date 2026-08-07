// ─── List-display noise floor — DISPLAY ONLY, never derivation ─────────────────
//
// The deriver emits every segment it finds, including 1-event blips (that's
// doctrine: suppressing in derivation is tuning the record). But the default
// /jobs list is for reading a season at a glance, so sessions below this floor
// hide behind a "show all sessions" toggle.
//
// A session hides when it is short OR sparse — real work is both sustained and
// dense. Aug 5 calibration: the three positioning fragments all fail one leg
// (1 impact / 0 min · 3 impacts in 10 min · 30 impacts in 1 min) and hide;
// the 3.5 h, 1,187-impact cutting session passes both and shows.

export const JOB_LIST_MIN = {
  durationS: 5 * 60,
  eventCount: 20,
} as const

export function isMinorJob(job: { duration_s: number; event_count: number }): boolean {
  return job.duration_s < JOB_LIST_MIN.durationS || job.event_count < JOB_LIST_MIN.eventCount
}
