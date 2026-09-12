'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import LogIt, { useLauncherMounted } from '@/app/dashboard/components/LogIt'
import SaveStatus from '@/app/dashboard/components/SaveStatus'
import { useOutbox } from '@/lib/outbox'
import { takeDiscardedNotice } from '@/lib/private-state'
import { warning } from '@/lib/brand-colors'
import RecordFab from './RecordFab'

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
function SyncRefresh() {
  const router = useRouter()
  const items = useOutbox()
  const seen = useRef<Set<string> | null>(null)
  if (seen.current === null) seen.current = new Set(items.filter(i => i.state === 'synced').map(i => i.id))
  useEffect(() => {
    let fresh = false
    for (const i of items) if (i.state === 'synced' && !seen.current!.has(i.id)) { seen.current!.add(i.id); fresh = true }
    if (fresh) router.refresh()
  }, [items, router])
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
  if (launcher) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 z-30 px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)' }} data-audit="global-save-status">
      <div className="pointer-events-auto mx-auto max-w-2xl pr-32 md:pr-0"><SaveStatus fadeAfterMs={90_000} /></div>
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
  if (!signedIn) return null
  return (
    <>
      <SyncRefresh />
      <DiscardedOnSwitch />
      <LogIt launcher={false} />
      <GlobalSaveStatus />
      <RecordFab />
    </>
  )
}
