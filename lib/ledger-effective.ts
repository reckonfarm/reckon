// ─── The effective ledger (Block 5B, migration 054) ───────────────────────────
// A correction is a new events row that supersedes its original; a void is a
// superseding row with voided_at set. The database stamps the ORIGINAL's
// superseded_by (trigger events_supersede_stamp), so every balance, every
// "last …" answer, and every summary takes the rows that currently stand with
// one filter: not superseded, not a void. The record (/activity) deliberately
// does NOT use it — paper keeps the crossed-out line legible.
//
// Balance cutoffs stay on the RANCH day of the row's WORK time (ts): a
// correction recorded today for Tuesday's work carries Tuesday's ts, so it
// lands on Tuesday in every balance, and a correction dated before a physical
// count falls before that count (dayKey in lib/jobs/format is America/Denver).

interface Filterable<T> { is(column: string, value: null): T }

// Block 7D — DELETED IS A THIRD STATE, and it outranks the other two. A
// superseded row still counts through its correction and a void still counts
// as news; a deleted row counts for nothing anywhere and appears on no
// surface, the record included. Every filter below therefore starts from
// `live`, so a new reader cannot pick the wrong one and show a deleted entry.
export function live<T extends Filterable<T>>(q: T): T {
  return q.is('deleted_at', null)
}

export function effective<T extends Filterable<T>>(q: T): T {
  return live(q).is('superseded_by', null).is('voided_at', null)
}

// The read used for "what is news": a superseded original is no longer news
// (its correction is), but a void IS news — someone reversed an entry.
export function notSuperseded<T extends Filterable<T>>(q: T): T {
  return live(q).is('superseded_by', null)
}
