import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { getHayLedger } from '@/lib/hay/queries'
import { ranchYearStart } from '@/lib/jobs/format'

// GET /api/ranch/hay-on-hand → { bales: number | null, asOf: string | null }
//
// The one number the Count hay form needs before it saves, so it can say what
// the count will DO — "This sets ranch hay on hand to 200 bales (was 261)."
// Without it the operator types a number into a void and finds out afterwards.
//
// Deliberately its own small route rather than a prop from the root layout:
// app/layout.tsx mounts the record sheet on every page in the app, signed out
// and public ones included, and a hay ledger read on every request to pay for
// one sentence in one form would be the wrong trade on one bar of 3G. This is
// fetched only when that form opens.
//
// `bales` is NULL when the ranch has no counted baseline — the ledger refuses
// to infer on-hand from stacked − fed, because the logs cannot know what was
// in the stack before logging started. The form says the shorter sentence then.
export async function GET(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const ledger = await getHayLedger(session.supabase, { since: ranchYearStart() })
    const onHand = ledger?.summary?.onHand ?? null
    return NextResponse.json({ bales: onHand ? onHand.bales : null, asOf: ledger?.summary?.baseline?.asOf ?? null })
  } catch {
    // Never block the form on this — it is a courtesy sentence, not a gate.
    return NextResponse.json({ bales: null, asOf: null })
  }
}
