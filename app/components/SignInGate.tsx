'use client'

import { useEffect } from 'react'
import { openSignInSheet } from '@/lib/sign-in-sheet'

// ─── A page that is nothing but the sign-in sheet (Block 49) ─────────────────
// Settings has no example to show — the work order's one exception — so a
// signed-out /account opens the sheet straight away, over one line that says
// why, with the page behind it as the landing after sign-in.
export default function SignInGate({ returnTo, children }: { returnTo: string; children?: React.ReactNode }) {
  useEffect(() => {
    const t = setTimeout(() => openSignInSheet({ returnTo }), 0)
    return () => clearTimeout(t)
  }, [returnTo])
  return (
    <div data-audit="sign-in-gate">
      {children}
      <button type="button" onClick={() => openSignInSheet({ returnTo })} className="mt-3 inline-flex min-h-[56px] w-full items-center justify-center rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream hover:bg-forest-green/90" data-audit="sign-in-gate-button">
        Sign in
      </button>
    </div>
  )
}
