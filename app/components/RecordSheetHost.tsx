'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import LogIt, { useLauncherMounted } from '@/app/dashboard/components/LogIt'
import SaveStatus from '@/app/dashboard/components/SaveStatus'
import { useOutbox } from '@/lib/outbox'
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
      <LogIt launcher={false} />
      <GlobalSaveStatus />
      <RecordFab />
    </>
  )
}
