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

// ─── In progress — ended_at still advancing ────────────────────────────────────
//
// A job's ended_at is the timestamp of its last recorded impact, and the cron
// re-derives every 3 minutes, so a machine that is still working keeps pushing
// ended_at forward. Within this window the job is treated as live: it shows an
// IN PROGRESS badge and is exempt from the minor-session floor above — a baler
// job 4 minutes in is short and sparse by definition, and hiding it would blank
// the list during the exact minutes someone is watching it fill.
//
// The window is deliberately loose (10 min vs the 3-min cron) to ride out sync
// hiccups, but a device that syncs in long bursts can still flicker the badge
// off between bursts. That flicker is honest — the ledger really hasn't heard
// anything — so it is not smoothed.

export const IN_PROGRESS_WINDOW_MS = 10 * 60 * 1000

// nowMs defaults here (same pattern as lib/barn-geo.ts) so render code never
// calls Date.now() directly — react-hooks/purity keeps component bodies clean.
export function isInProgress(job: { ended_at: string }, nowMs: number = Date.now()): boolean {
  return nowMs - Date.parse(job.ended_at) < IN_PROGRESS_WINDOW_MS
}
