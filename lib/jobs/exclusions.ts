// ─── Test-data convention + explicit derivation exclusions ─────────────────────
//
// THE CONVENTION (established 2026-08-06, after the seq-collision near-miss):
// bench/smoke work NEVER runs under a production hardware_id. A bench unit is a
// separate devices row whose hardware_id carries the `bench-` prefix
// (e.g. `bench-14c19f3534f0`, provisioned in production, ranch_id null so bench
// noise stays out of the shared ranch ledger). Why it's a hard rule: dedupe is
// (user_id, "{hardware_id}:{seq}") — a synthetic seq injected under the real
// hardware_id permanently squats that seq, and when the device's real counter
// reaches it the genuine event is ACKED TO THE COURIER AND SILENTLY DROPPED.
// Four such rows (seqs 11000/11001/990201/990202) were deleted on 2026-08-06.
//
// The deriver excludes bench data EXPLICITLY, never heuristically:
//   1. any hardware_id with the `bench-` prefix is skipped wholesale;
//   2. EXCLUDED_SEQ_RANGES below pins down pre-convention pollution by exact
//      seq range on the real hardware. Editing this list is a deriver change —
//      bump DERIVER_VERSION in derive.ts and re-run so jobs stay reproducible.

export const BENCH_HARDWARE_PREFIX = 'bench-'

export interface ExcludedSeqRange {
  hardwareId: string
  fromSeq: number // inclusive
  toSeq: number   // inclusive
  reason: string
}

export const EXCLUDED_SEQ_RANGES: ExcludedSeqRange[] = [
  {
    hardwareId: '14c19f3534f0',
    fromSeq: 1,
    toSeq: 48,
    reason:
      'Pre-field bench/pocket period, Jul 29 – Aug 2 2026 (garage handling, carry tests). ' +
      'The first field mount is the Aug 5 swather day, which starts at seq 49.',
  },
]

export function isBenchHardware(hardwareId: string): boolean {
  return hardwareId.startsWith(BENCH_HARDWARE_PREFIX)
}

export function isExcludedSeq(hardwareId: string, seq: number): boolean {
  return EXCLUDED_SEQ_RANGES.some(
    r => r.hardwareId === hardwareId && seq >= r.fromSeq && seq <= r.toSeq
  )
}
