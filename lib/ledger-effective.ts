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
//
// `on` is the 061 capability (lib/schema-capability.ts). False means the column
// does not exist yet, so there is nothing to filter and every entry is live —
// which is exactly true of a database where nothing can have been deleted.
// TEMPORARY: when 061 is applied, drop the argument and the branch with it.
export function live<T extends Filterable<T>>(q: T, on = true): T {
  return on ? q.is('deleted_at', null) : q
}

export function effective<T extends Filterable<T>>(q: T, on = true): T {
  return live(q, on).is('superseded_by', null).is('voided_at', null)
}

// The read used for "what is news": a superseded original is no longer news
// (its correction is), but a void IS news — someone reversed an entry.
export function notSuperseded<T extends Filterable<T>>(q: T, on = true): T {
  return live(q, on).is('superseded_by', null)
}

/**
 * The three filters, bound to one capability answer.
 *
 * Call sites destructure this and their query expressions are unchanged:
 *
 *   const { effective } = ledgerFilters(await hasEventDeletion(supabase))
 *
 * TEMPORARY, with lib/schema-capability.ts. When 061 is applied, delete this
 * and let the plain exports stand — every call site keeps compiling.
 */
export function ledgerFilters(on: boolean) {
  return {
    live: <T extends Filterable<T>>(q: T): T => live(q, on),
    effective: <T extends Filterable<T>>(q: T): T => effective(q, on),
    notSuperseded: <T extends Filterable<T>>(q: T): T => notSuperseded(q, on),
  }
}
