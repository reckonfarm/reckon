'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import BottomSheet from '@/app/components/BottomSheet'
import SignInForm from '@/app/signin/SignInForm'
import { closeSignInSheet, openSignInSheet, setSession, useSignInAsk, here } from '@/lib/sign-in-sheet'

// ─── The sign-in sheet (Block 49, ruling R1) ─────────────────────────────────
// Mounted once in the root layout. It knows whether the phone has a session
// (the browser client's own read — no network) and tells the store, so every
// write control can ask requireSignIn() before it writes. When a control
// asks, this renders the existing sign-in form in a bottom sheet with
// `returnTo` as its landing, so after sign-in the person is back on the exact
// action they tapped. A signed-out arrival with ?record= in the address (a
// home-screen shortcut, or a sign-in return) is a tap on Record: the sheet
// opens straight away.
export default function SignInSheet() {
  const ask = useSignInAsk()
  const pathname = usePathname()
  const params = useSearchParams()
  const record = params.get('record')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => setSession(data.session?.user ? 'in' : 'out')).catch(() => setSession('out'))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session?.user ? 'in' : 'out')
      if (session?.user) closeSignInSheet()
    })
    return () => subscription.unsubscribe()
  }, [])

  // ?record= with no session: the shortcut's tap, answered with the sheet.
  useEffect(() => {
    if (!record) return
    const t = setTimeout(() => {
      const supabase = createClient()
      supabase.auth.getSession().then(({ data }) => { if (!data.session?.user) openSignInSheet({ returnTo: here() }) }).catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [record, pathname])

  if (!ask) return null
  return (
    <BottomSheet open onClose={closeSignInSheet} label="Sign in to Dryline" panelAudit="sign-in-sheet" z={80}>
      <div className="px-5 pb-8 pt-2">
        <SignInForm next={ask.returnTo} initialMode={ask.mode} inSheet />
      </div>
    </BottomSheet>
  )
}
