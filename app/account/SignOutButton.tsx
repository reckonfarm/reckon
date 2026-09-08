'use client'

import { hasUnsynced } from '@/lib/outbox'
import { signOutEverywhere } from '@/lib/private-state'

// Sign out lives on /account (Block 6A). Same path as before: warn about
// unsynced entries, end the session, clear every private key, load a fresh
// signed-out document (Block 5D).
export default function SignOutButton() {
  async function signOut() {
    if (hasUnsynced() && !window.confirm('Some entries have not synced to the ranch yet. Sign out anyway and lose them?')) return
    await signOutEverywhere('/')
  }
  return (
    <button type="button" onClick={signOut} className="mt-3 inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink hover:bg-forest-green/5" data-audit="sign-out">
      Sign out
    </button>
  )
}
