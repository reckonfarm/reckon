'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { usePathname, useRouter } from 'next/navigation'
import { useUndoOwnsTheSlot } from '@/lib/undo'
import LogIt, { useLauncherMounted } from '@/app/dashboard/components/LogIt'
import SaveStatus from '@/app/dashboard/components/SaveStatus'
import { useOutbox } from '@/lib/outbox'
import { setRecordAvailable } from '@/lib/record-sheet-state'
import RecordFab from './RecordFab'
import UndoStrip from './UndoStrip'
import WaitingLine from './WaitingLine'
import { takeDiscardedNotice } from '@/lib/private-state'
import { warning } from '@/lib/brand-colors'

// ─── The record sheet, mounted once for a signed-in person (Block 6A) ─────────
// Any surface opens it with openLogIt(): the FAB, the header's Record, a place
// page's Record here, Today's Quick record. One sheet, one draft, one outbox.
// Signed out there is nothing to mount — a public county page never offers a
// Record that can only 401.

// ─── Block 6D: a save refreshes what it changed, from every entry point ───────
// The audit saved a feeding from Ranch: the sheet closed and the hub still
// read the old bales and the old recent rows. Now ONE component, on every
// signed-in page, refreshes the server-rendered ledgers once per entry that
// syncs while it is mounted (never for entries that had synced before), and
// the receipt strip stands on every page that has no Today launcher of its
// own — a closed sheet never leaves anyone wondering whether it saved.
// Pending local work stays visible in the strip's own words (Saved on this
// phone · Waiting to sync), apart from the confirmed shared totals behind it.
//
// Block 32 — the page PROVES it caught up. A refresh is a hope: it can be
// discarded by a navigation, land on another page, or take long enough that
// the number is read before it arrives — on the audit, 41 feedings in, the
// receipt said 3,075 and Today's tile said 3,123, exactly the last two. Every
// ledger page now stamps what its render read (lib/ledger-through.ts), the
// outbox keeps each synced record's ingested_at, and this compares the two:
// while the painted stamp is older than the newest record this phone knows
// landed, it refreshes again, on a backoff, and it re-checks on every page
// and each time the phone wakes (a pickup nap ends on Today, and Today
// catches up with no tap — what another hand recorded too). A page with no
// stamp paints no ledger number and has nothing to catch up on.
const RECHECK_MS = 1_500
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000]   // ~90 s, then the next wake or sync starts again
function readStamp(): string | null | undefined {
  const el = typeof document === 'undefined' ? null : document.querySelector('[data-audit="ledger-through"]')
  if (!el) return undefined                      // not a ledger page
  return el.getAttribute('data-through') || null // '' = a ranch with no records yet
}
function SyncRefresh() {
  const router = useRouter()
  const pathname = usePathname()
  const items = useOutbox()
  const seen = useRef<Set<string> | null>(null)
  const target = useRef<string | null>(null)     // newest ingested_at this phone knows landed
  const tries = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, startTransition] = useTransition()
  if (seen.current === null) seen.current = new Set(items.filter(i => i.state === 'synced').map(i => i.id))

  // Never while offline: a refresh with no signal fails its fetch and the
  // router falls back to a full navigation — the page reloads and the receipt
  // on it is gone. With one bar in a corral that would happen on every retry.
  // The page catches up when the signal returns (the 'online' listener below).
  const canRefresh = () => typeof navigator === 'undefined' || navigator.onLine !== false
  const refresh = () => { if (canRefresh()) startTransition(() => router.refresh()) }
  const arm = (ms: number) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(recheck, ms) }
  // Is the painted stamp at or past what this phone knows landed? If not, refresh again.
  const recheck = () => {
    timer.current = null
    const stamp = readStamp()
    if (stamp === undefined || !target.current) return
    if (stamp && Date.parse(stamp) >= Date.parse(target.current)) { tries.current = 0; return }
    if (!canRefresh()) return
    const wait = RETRY_MS[tries.current]
    if (wait == null) return
    tries.current += 1
    refresh(); arm(wait + RECHECK_MS)
  }

  useEffect(() => {
    let fresh = false
    for (const i of items) if (i.state === 'synced' && !seen.current!.has(i.id)) {
      seen.current!.add(i.id); fresh = true
      if (i.ingestedAt && (!target.current || Date.parse(i.ingestedAt) > Date.parse(target.current))) target.current = i.ingestedAt
    }
    if (fresh) { tries.current = 0; refresh(); arm(RECHECK_MS) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  // A new page: check it against what is known, without a refresh first.
  useEffect(() => {
    tries.current = 0; arm(RECHECK_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  // Waking, or the signal coming back: refresh once, then prove it.
  useEffect(() => {
    const onWake = () => { if (document.visibilityState === 'visible') { tries.current = 0; refresh(); arm(RECHECK_MS) } }
    const onSignal = () => { tries.current = 0; refresh(); arm(RECHECK_MS) }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onSignal)
    return () => { document.removeEventListener('visibilitychange', onWake); window.removeEventListener('online', onSignal) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

// Block 7.1 — an account switch cannot ask the previous person whether to keep
// their unsynced entries (their session is already gone, and privacy forbids
// leaving the entries readable). It discards them, and leaves the COUNT for the
// arriving session to say once. Better the ranch hears about a lost entry than
// never learns of it. Read-and-forget: it shows a single time.
function DiscardedOnSwitch() {
  const [n, setN] = useState(0)
  // Read on a task, not in the effect body: localStorage does not exist during
  // the server render, so this cannot be a lazy useState initializer, and a
  // synchronous setState inside an effect is the cascading-render pattern the
  // lint rule forbids. A read-and-forget of an external store belongs in a
  // callback either way.
  useEffect(() => { const t = setTimeout(() => setN(takeDiscardedNotice()), 0); return () => clearTimeout(t) }, [])
  if (n === 0) return null
  return (
    <div className="mx-auto mt-3 max-w-2xl px-4" role="status" data-audit="discarded-on-switch">
      <p className="rounded-lg border px-4 py-3 font-dm-sans text-[16px] leading-snug" style={{ color: warning, borderColor: warning }}>
        {n} {n === 1 ? 'entry' : 'entries'} from the person signed in before you never reached the ranch, and could not be kept when the account changed. {n === 1 ? 'It was' : 'They were'} not recorded.
      </p>
    </div>
  )
}

function GlobalSaveStatus() {
  const launcher = useLauncherMounted()
  const pathname = usePathname()
  // Block 23 (ruling 2): the receipt shares this slot with the Undo strip. A
  // receipt is news; an Undo is a ten-second chance to take something back.
  // The news waits — but it is HIDDEN, never unmounted. SaveStatus starts a
  // clock when it mounts and treats anything synced before that as history, so
  // unmounting it for the ten seconds of an Undo threw away the receipt for
  // every record that landed during those ten seconds. The record synced; the
  // person simply never saw it say so.
  const undoShowing = useUndoOwnsTheSlot()
  if (launcher) return null
  // Block 11 (P0): keyed by pathname, so leaving a page ends its receipt. The
  // strip is fixed above the bottom nav, and on the audit it landed ON TOP of
  // Correct / Void / Delete on an entry page and swallowed the taps — two
  // Deletes did nothing until the receipt was scrolled out of the viewport,
  // from which the only reasonable conclusion is that Delete is broken.
  //
  // pointer-events stay off the whole layer now. Nothing inside a transient
  // receipt is worth a tap that a real control underneath might have wanted:
  // its link is a convenience, and Undo / Try again / Sync now all belong to
  // states that are NOT this one (the strip renders those inline on Today,
  // where it is in the flow and cannot cover anything).
  return (
    <div className={`pointer-events-none fixed inset-x-0 z-30 px-4${undoShowing ? ' invisible' : ''}`} style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }} data-audit="global-save-status" data-yielded={undoShowing ? 'true' : undefined}>
      <div className="mx-auto max-w-2xl"><SaveStatus key={pathname} fadeAfterMs={90_000} compact /></div>
    </div>
  )
}

export default function RecordSheetHost() {
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session?.user)).catch(() => {})
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setSignedIn(!!session?.user))
    return () => subscription.unsubscribe()
  }, [])
  // Block 11 (11.4): the bar's Record item lives in the root layout and would
  // otherwise offer a tap with no sheet behind it to a signed-out visitor.
  useEffect(() => { setRecordAvailable(signedIn); return () => setRecordAvailable(false) }, [signedIn])
  if (!signedIn) return null
  return (
    <>
      <SyncRefresh />
      <DiscardedOnSwitch />
      <LogIt launcher={false} />
      <GlobalSaveStatus />
      {/* Block 13: the ten-second Undo after any delete. */}
      <UndoStrip />
      {/* Block 15 (ruling 5): one line for whatever is waiting. */}
      <WaitingLine />
      <RecordFab />
    </>
  )
}
