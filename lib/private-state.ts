// ─── Private state on the phone (Block 5D) ────────────────────────────────────
// Everything the app keeps in the browser that belongs to ONE person: the
// outbox (entries, their labels, the answers the server gave — "171 bales on
// hand"), the Log it draft, the last lot / place, the hay draft, the farmer
// type, and the per-tab dismissals. On a shared pickup phone the next person
// must never read any of it. Two moments clear it:
//
//   · sign-out (signOutEverywhere): the session is ended, every key is removed,
//     and the page is replaced by a fresh document — a full navigation, so no
//     server-rendered private content and no client router cache survives;
//   · account switch (bindPrivateStateTo): whenever the signed-in user id is not
//     the one this state was written under, the state is cleared before anything
//     reads it — covers a magic link opened by a different person, an expired
//     session, an invite accepted by a second account, with no sign-out in between.
//
// BLOCK 7.1 — the switch cannot offer the sign-out sheet's choice, and it is
// worth being exact about why. By the time a switch is detectable the previous
// person's session is already gone: their entries cannot be uploaded (the
// outbox refuses to post an entry whose owner is not the current session) and
// they cannot be asked whether to keep them, because they are not the one
// holding the phone. Privacy also forbids leaving them where the arriving
// person could read them. So the work IS discarded — but never in silence: the
// COUNT (a number, never any content) is left behind for the arriving session
// to show once, so a lost entry is something the ranch learns about instead of
// something it never hears.
//
// The outbox additionally stamps each entry with its owner and refuses to
// upload an entry whose owner is not the current session (lib/outbox.ts), so a
// race between the guard and the sync timer can never post one person's
// feeding as another's.

import { createClient } from '@/lib/supabase-browser'
import { clearOutbox, unsyncedCount, OWNER_KEY } from '@/lib/outbox'

export { OWNER_KEY }

// Every localStorage key that can carry one person's data. Add here when a new
// surface stores something private; the smoke asserts none survive a sign-out.
export const PRIVATE_KEYS = [
  'dryline_outbox_v1',        // lib/outbox
  'manual_log_draft_v1',      // LogIt draft
  'manual_log_last_lot',      // LogIt — last lot fed
  'manual_log_last_place',    // LogIt — last place
  'dryline_hay_draft_v1',     // /hay listing draft
  'farmer_type',              // ProgramStatus
] as const

export function clearPrivateState(): void {
  try { for (const k of PRIVATE_KEYS) localStorage.removeItem(k) } catch { /* private mode */ }
  try { localStorage.removeItem(OWNER_KEY) } catch { /* private mode */ }
  try { sessionStorage.clear() } catch { /* private mode */ }
  clearOutbox()   // the in-memory snapshot too, so mounted strips empty at once
}

export function currentOwner(): string | null {
  try { return localStorage.getItem(OWNER_KEY) } catch { return null }
}

// Call with the signed-in user id (or null when signed out) whenever auth
// state is known. State written under a different person is cleared first.
/** Set by an account switch that had to discard unsynced work. A count only. */
export const DISCARDED_KEY = 'dryline_discarded_on_switch'

export function bindPrivateStateTo(uid: string | null): void {
  const prev = currentOwner()
  if (uid === null) return                       // signed out: sign-out already cleared; nothing to bind
  if (prev !== null && prev !== uid) {
    const lost = unsyncedCount()
    clearPrivateState()
    // Written AFTER the clear, so it survives it. A number, nothing else.
    if (lost > 0) { try { localStorage.setItem(DISCARDED_KEY, String(lost)) } catch { /* private mode */ } }
  }
  try { localStorage.setItem(OWNER_KEY, uid) } catch { /* private mode */ }
}

/** Read once and forget: how many entries the last account switch discarded. */
export function takeDiscardedNotice(): number {
  try {
    const v = localStorage.getItem(DISCARDED_KEY)
    if (!v) return 0
    localStorage.removeItem(DISCARDED_KEY)
    return Number(v) || 0
  } catch { return 0 }
}

// End the session, clear everything private, and load `next` as a fresh
// document. Never a client-side route change: the next page must be rendered
// signed-out by the server, with nothing of the previous person in memory.
export async function signOutEverywhere(next = '/'): Promise<void> {
  try { await createClient().auth.signOut() } catch { /* the cookies are cleared below regardless of the network */ }
  clearPrivateState()
  window.location.replace(next)
}
