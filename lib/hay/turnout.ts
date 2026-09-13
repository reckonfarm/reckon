import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { effective } from '@/lib/ledger-effective'
import { todayKey } from '@/lib/jobs/format'

// ─── The turnout date (Block 9) ───────────────────────────────────────────────
//
// The day the cattle go back to grass. PK's ruling: asked once, in the hay
// planning surface itself and not buried in settings; last year's remembered
// and OFFERED as the default, editable; NEVER auto-set. So nothing here
// derives a date — the FSA grazing period is a program window, not his ground,
// and Block 1 already got burned reading Petroleum's Dec 1 as a fact about the
// ranch. A turnout date exists because he typed it.
//
// Stored as an ordinary events row, no migration: events.type is text
// precisely so "new event types must never require a migration" (031). It is
// deliberately NOT in MANUAL_EVENT_TYPES — the Log it sheet does not offer it
// and the Activity record does not list it, because the record is what
// HAPPENED on the ranch and this is a plan. Membership-gated by 043 like every
// other row, so it is scoped to the ranch without a line of new policy.
//
// Changing it supersedes the old row through 054, the same correction
// mechanism everything else uses, so `effective` returns exactly one live
// turnout per season and the history stays legible.

export const TURNOUT_TYPE = 'turnout'

export interface Turnout {
  id: string
  /** 'YYYY-MM-DD' — the ranch day the cattle go to grass. */
  date: string
  /** When he set it. */
  setAt: string
}

export interface TurnoutState {
  /** The next turnout he has set, if any. */
  upcoming: Turnout | null
  /** The most recent one already past — what the default is offered from. */
  last: Turnout | null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date is a turnout date only if it is a real ranch day. */
export function isTurnoutDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DAY.test(v)) return false
  const d = new Date(`${v}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

interface Row { id: string; ts: string; payload: Record<string, unknown> | null }

const toTurnout = (r: Row): Turnout | null => {
  const date = (r.payload ?? {}).date
  return isTurnoutDate(date) ? { id: r.id, date, setAt: r.ts } : null
}

/**
 * What he has set. Read on the caller's own client, so RLS scopes it to his
 * ranch. Returns both halves because the surface needs both: the upcoming date
 * to answer with, and last year's to offer when there is no upcoming one.
 */
export async function getTurnout(supabase: SupabaseClient, nowMs: number = Date.now()): Promise<TurnoutState> {
  try {
    const { data, error } = await effective(supabase
      .from('events')
      .select('id, ts, payload')
      .eq('type', TURNOUT_TYPE))
      .order('ts', { ascending: false })
      .limit(50)
    if (error) return { upcoming: null, last: null }

    const all = ((data ?? []) as Row[]).map(toTurnout).filter((t): t is Turnout => t !== null)
    const today = todayKey(nowMs)
    // Newest-set wins among the ones still ahead — he may have changed his
    // mind twice in a week and the last word is the answer.
    const upcoming = all.find(t => t.date >= today) ?? null
    // Latest DATE among the ones behind — "last year you turned out May 15"
    // means the most recent turnout, not the most recently typed row.
    const past = all.filter(t => t.date < today).sort((a, b) => b.date.localeCompare(a.date))
    return { upcoming, last: past[0] ?? null }
  } catch {
    return { upcoming: null, last: null }
  }
}

/**
 * The date to OFFER when nothing is set: last year's month and day, moved to
 * its next occurrence. Offered, never applied — the surface shows it as a
 * suggestion with his own words on it ("Last year you turned out May 15") and
 * he still has to say yes.
 */
export function suggestedTurnout(last: Turnout | null, nowMs: number = Date.now()): string | null {
  if (!last) return null
  const today = todayKey(nowMs)
  const monthDay = last.date.slice(5)
  const year = Number(today.slice(0, 4))
  // Feb 29 lands on Mar 1 in a common year rather than vanishing.
  const at = (y: number) => {
    const d = new Date(`${y}-${monthDay}T12:00:00Z`)
    return Number.isNaN(d.getTime()) ? `${y}-03-01` : d.toISOString().slice(0, 10)
  }
  const thisYear = at(year)
  return thisYear > today ? thisYear : at(year + 1)
}
