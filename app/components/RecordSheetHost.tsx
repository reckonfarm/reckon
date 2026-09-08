'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import LogIt from '@/app/dashboard/components/LogIt'
import RecordFab from './RecordFab'

// ─── The record sheet, mounted once for a signed-in person (Block 6A) ─────────
// Any surface opens it with openLogIt(): the FAB, the header's Record, a place
// page's Record here, Today's Quick record. One sheet, one draft, one outbox.
// Signed out there is nothing to mount — a public county page never offers a
// Record that can only 401.

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
      <LogIt launcher={false} />
      <RecordFab />
    </>
  )
}
