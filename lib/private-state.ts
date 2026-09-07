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
// The outbox additionally stamps each entry with its owner and refuses to
// upload an entry whose owner is not the current session (lib/outbox.ts), so a
// race between the guard and the sync timer can never post one person's
// feeding as another's.

import { createClient } from '@/lib/supabase-browser'
import { clearOutbox, OWNER_KEY } from '@/lib/outbox'

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
export function bindPrivateStateTo(uid: string | null): void {
  const prev = currentOwner()
  if (uid === null) return                       // signed out: sign-out already cleared; nothing to bind
  if (prev !== null && prev !== uid) clearPrivateState()
  try { localStorage.setItem(OWNER_KEY, uid) } catch { /* private mode */ }
}

// End the session, clear everything private, and load `next` as a fresh
// document. Never a client-side route change: the next page must be rendered
// signed-out by the server, with nothing of the previous person in memory.
export async function signOutEverywhere(next = '/'): Promise<void> {
  try { await createClient().auth.signOut() } catch { /* the cookies are cleared below regardless of the network */ }
  clearPrivateState()
  window.location.replace(next)
}
