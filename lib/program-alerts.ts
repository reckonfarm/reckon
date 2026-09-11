import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { droughtSeverity, type UsdmReading } from '@/lib/drought-severity'
import type { UpcomingDeadlinesResult } from '@/lib/rma-deadline-service'

/** A USDM reading with the week it is valid for — the shape the shell holds. */
export type DatedReading = UsdmReading & { week_date: string }

// ─── Change-only alerts (Block 7.9) ───────────────────────────────────────────
//
// Today shows a program alert ONLY when something actually changed. Three
// things qualify, and nothing else does:
//   · the county's drought designation moved (D2 → D3, or into / out of drought)
//   · the LFP tier moved
//   · a deadline from lib/programDates.ts came 30, 7 or 1 days away
//
// THE WHOLE DESIGN IS IN THE KEY. Each alert carries an `key` that encodes WHAT
// changed and WHEN, never "when you last looked":
//   drought:30069:D2>D3:2026-09-08
//   lfp:30069:tier:1>2:2026-09-08
//   deadline:prf:sales_closing:2026-12-01:30
// Dismissing stores that key. So a later, different change has a different key
// and alerts again, and an unchanged weekly USDM publication produces no change
// at all and therefore no alert — the two failure modes a timestamp cursor
// (ranch_members.last_seen_at / markets_seen_at) gets wrong in both directions.
//
// A deadline crossing 30 → 7 → 1 is three separate alerts on purpose: each is a
// different fact about how much time is left, and dismissing "30 days" must not
// silence "tomorrow".
//
// Migration 059 stores the dismissals. Until PK runs it, readDismissals returns
// an empty set and every alert simply shows — the code never depends on the
// table existing.

export type ProgramAlertKind = 'drought' | 'lfp' | 'deadline'

export interface ProgramAlert {
  key: string
  kind: ProgramAlertKind
  headline: string
  detail: string
}

const cat = (r: UsdmReading | null): string => {
  const s = droughtSeverity(r)
  return s.level == null ? 'none' : `D${s.level}`
}

const DEADLINE_WINDOWS = [30, 7, 1] as const

/**
 * Pure. `latest` and `prior` are consecutive USDM readings for the ranch's
 * county, newest first; either may be null.
 */
export function buildProgramAlerts(input: {
  fips: string
  countyName: string
  latest: DatedReading | null
  prior: DatedReading | null
  lfpTier: number | null
  priorLfpTier: number | null
  deadlines: UpcomingDeadlinesResult
}): ProgramAlert[] {
  const out: ProgramAlert[] = []
  const { fips, countyName, latest, prior } = input

  // 1) Drought designation moved. Requires two readings — with only one on
  //    record nothing has changed yet, and a first observation is not news.
  if (latest && prior) {
    const now = cat(latest), was = cat(prior)
    if (now !== was) {
      const week = latest.week_date
      out.push({
        key: `drought:${fips}:${was}>${now}:${week}`,
        kind: 'drought',
        headline: now === 'none'
          ? `${countyName} is out of drought`
          : was === 'none'
            ? `${countyName} entered drought — ${droughtSeverity(latest).label}`
            : `${countyName} moved ${was} → ${now}`,
        detail: `U.S. Drought Monitor, valid ${week}. This is the designation FSA reads for LFP.`,
      })
    }
  }

  // 2) LFP tier moved. Tier, not payment count: the tier is the thing FSA
  //    determines and the thing that changes what a rancher can claim.
  if (input.lfpTier != null && input.priorLfpTier != null && input.lfpTier !== input.priorLfpTier) {
    const week = latest?.week_date ?? 'latest'
    out.push({
      key: `lfp:${fips}:tier:${input.priorLfpTier}>${input.lfpTier}:${week}`,
      kind: 'lfp',
      headline: input.lfpTier === 0
        ? `${countyName} no longer meets an LFP tier`
        : `${countyName} is at LFP tier ${input.lfpTier}`,
      detail: input.priorLfpTier === 0
        ? 'It met no tier at the last reading. FSA makes the final determination.'
        : `It was tier ${input.priorLfpTier} at the last reading. FSA makes the final determination.`,
    })
  }

  // 3) A deadline crossed 30 / 7 / 1 days. Every alert names its program —
  //    a bare date under an LFP card reads as an LFP date, and Dec 1 is PRF's.
  if (input.deadlines.status === 'ok') {
    for (const d of input.deadlines.deadlines) {
      const hit = DEADLINE_WINDOWS.find(w => d.daysUntil === w)
      if (hit == null) continue
      out.push({
        key: `deadline:${d.crop_or_program}:${d.deadline_type}:${d.deadline_date}:${hit}`,
        kind: 'deadline',
        headline: hit === 1
          ? `${label(d.crop_or_program)} ${label(d.deadline_type)} is tomorrow`
          : `${label(d.crop_or_program)} ${label(d.deadline_type)} is ${hit} days away`,
        detail: `${d.deadline_date}. Dates come from Dryline's verified program list, not from a table that can drift.`,
      })
    }
  }
  return out
}

const label = (s: string) => s.replace(/_/g, ' ').toUpperCase() === s.toUpperCase() && s.length <= 4 ? s.toUpperCase() : s.replace(/_/g, ' ')

/**
 * The keys this person has already dismissed.
 *
 * TOLERANT BY DESIGN: any failure — the table not existing yet, RLS, a dropped
 * connection — returns an empty set, which means "nothing dismissed" and every
 * current alert shows. An alert shown twice is a small annoyance; an alert
 * silently swallowed because a read failed is the kind of thing that loses a
 * rancher money.
 */
export async function readDismissals(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('program_alert_dismissals')
      .select('alert_key')
      .eq('user_id', userId)
    if (error) return new Set()
    return new Set((data ?? []).map(r => r.alert_key as string))
  } catch {
    return new Set()
  }
}
