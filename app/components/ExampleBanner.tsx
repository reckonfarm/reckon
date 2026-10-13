'use client'

import { openSignInSheet } from '@/lib/sign-in-sheet'

// ─── "Example ranch · Make it yours →" (Block 49, ruling R2) ──────────────────
// One slim line at the top of every page that is showing the Dry Creek
// example instead of a person's own ranch. The tap opens the sign-in sheet in
// create-account mode and lands on Today once there is an account.
export default function ExampleBanner() {
  return (
    <div className="mb-4 flex min-h-[48px] items-center justify-between gap-3 rounded-lg border border-forest-green/15 bg-forest-green/[0.05] px-3" data-audit="example-banner">
      <p className="font-dm-sans text-[16px] font-semibold text-forest-green">Example ranch</p>
      <button
        type="button"
        onClick={() => openSignInSheet({ returnTo: '/today', mode: 'signup' })}
        className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2"
        data-audit="example-make-it-yours"
      >
        Make it yours →
      </button>
    </div>
  )
}
