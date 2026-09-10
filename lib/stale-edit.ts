import 'server-only'
import { createServiceClient } from '@/lib/supabase'

// ─── Two people, one row, one of them loses ───────────────────────────────────
//
// Lifted out of lib/herd-lots.ts (051/4B) unchanged so places can inherit it
// rather than grow a second dialect of the same sentence. It is the best-written
// error path in this codebase and the reason is worth keeping in front of
// whoever edits it next:
//
//   A stale-write message has to do four things at once, or the person just
//   loses their work and distrusts the app. It must name WHO changed it, say
//   WHEN, state plainly that nothing of theirs was overwritten, and tell them
//   their own typing is still on the screen. "Conflict — please retry" does
//   none of that.
//
// The optimistic token is `updated_at`, bumped by a database trigger on both
// tables (herd_lots 051:78-89, places 057) so no writer can forget to. The
// caller carries `.eq('updated_at', expected)` on the write; when it matches
// nothing, it asks here for the words.
//
// The profiles read uses the SERVICE ROLE deliberately: a member can see their
// own membership row but not another person's profile, and "someone changed
// this" is useless without a name. Nothing but display_name and email is read.

export interface StaleEdit {
  status: 409
  changed_by: string
  changed_at: string
  error: string
}

const RANCH_TZ = 'America/Denver'

/**
 * The person behind a `updated_by`, in the words the ranch uses. Falls back to
 * "Someone else on the ranch" — never to an id, never to an empty string.
 */
export async function changerName(updatedBy: string | null | undefined): Promise<string> {
  if (!updatedBy) return 'Someone else on the ranch'
  const { data } = await createServiceClient()
    .from('profiles')
    .select('display_name, email')
    .eq('id', updatedBy)
    .maybeSingle()
  const p = data as { display_name?: string | null; email?: string | null } | null
  return p?.display_name?.trim() || p?.email || 'Someone else on the ranch'
}

/**
 * The 409 a losing editor gets. `noun` is the operator's word for the thing —
 * "lot", "place" — and lands mid-sentence, so keep it lowercase and singular.
 */
export async function staleEdit(
  noun: string,
  row: { updated_by?: string | null; updated_at: string },
): Promise<StaleEdit> {
  const name = await changerName(row.updated_by)
  const at = new Date(row.updated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: RANCH_TZ })
  return {
    status: 409,
    changed_by: name,
    changed_at: row.updated_at,
    error: `${name} changed this ${noun} at ${at}, while you had it open. Your change was not saved over theirs — their version is on the screen now, and your entries are still in the form. Check theirs, then save yours again.`,
  }
}

/**
 * The other reason a guarded write matches nothing: the row left the live list
 * while the editor had it open. A 404, and it says the same reassuring thing —
 * nothing of yours was written.
 */
export function retiredWhileOpen(noun: string): string {
  return `That ${noun} was retired while you had it open. Nothing of yours was written; it is off the live list now.`
}
