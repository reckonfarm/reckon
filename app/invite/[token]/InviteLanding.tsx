'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/app/components/ui/Card'
import { Button } from '@/app/components/ui/Button'
import { signOutEverywhere } from '@/lib/private-state'
import type { InviteView } from '@/lib/invitations'

const CTA = 'inline-flex min-h-[52px] w-full items-center justify-center rounded-lg px-5 font-dm-sans text-[17px] font-semibold'

export default function InviteLanding({ token, view, signedInEmail }: { token: string; view: InviteView; signedInEmail: string | null }) {
  const next = encodeURIComponent(`/invite/${token}`)
  const matches = !!signedInEmail && signedInEmail === view.invited_email
  const [state, setState] = useState<'idle' | 'joining' | 'joined' | 'failed'>('idle')
  const [error, setError] = useState('')
  const started = useRef(false)

  async function join() {
    setState('joining'); setError('')
    try {
      const res = await fetch('/api/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError((j as { error?: string }).error ?? 'Could not accept the invitation.'); setState('failed'); return }
      setState('joined')
      // Hard navigation on purpose: the ranch home is server-resolved from the
      // new membership, and the installed PWA drops client navigations.
      window.location.assign('/home')
    } catch { setError('Could not reach the ranch — check your connection and try again.'); setState('failed') }
  }
  // Signed in as the invited person and the invite is open → join without another tap.
  useEffect(() => {
    if (view.state === 'open' && matches && !started.current) { started.current = true; join() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.state, matches])

  async function signOutAndSwitch() {
    // Block 5D: an account switch clears the previous person's private state too.
    await signOutEverywhere(`/signin?next=${next}`)
  }

  const ranch = view.ranch_name ?? 'a ranch'
  const can = view.role === 'owner'
    ? "You'll be able to see and log feed, hay counts, rain, and ranch work, and add or remove people."
    : "You'll be able to see and log feed, hay counts, rain, and ranch work."

  if (view.state !== 'open') {
    const why = view.state === 'expired' ? 'This invitation has expired.' : view.state === 'revoked' ? 'This invitation was revoked.' : view.state === 'accepted' ? 'This invitation has already been used.' : 'This invitation link is not valid.'
    return (
      <Card shadow="soft" className="p-6" data-audit="invite-closed">
        <h1 className="font-fraunces text-2xl font-semibold text-forest-green">{why}</h1>
        <p className="mt-2 font-dm-sans text-[16px] leading-relaxed text-ink">
          {view.state === 'accepted' && matches ? 'You are already on this ranch.' : `Ask ${view.inviter ?? 'the ranch owner'} to send a new one.`}
        </p>
        {view.state === 'accepted' && matches && <Link href="/home" className={`${CTA} mt-4 bg-forest-green text-cream`}>Open {ranch}</Link>}
      </Card>
    )
  }

  return (
    <Card shadow="soft" className="p-6" data-audit="invite-open">
      <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">{view.inviter ?? 'Someone'} invited you to {ranch}.</h1>
      <p className="mt-3 font-dm-sans text-[17px] leading-relaxed text-forest-green">{can}</p>

      {!signedInEmail && (
        <div className="mt-6 space-y-3" data-audit="invite-ctas">
          <Link href={`/signin?mode=signup&next=${next}`} className={`${CTA} bg-forest-green text-cream`}>Create your account</Link>
          <Link href={`/signin?next=${next}`} className={`${CTA} border border-forest-green/25 text-forest-green`}>I already have an account</Link>
          <p className="font-dm-sans text-[16px] text-ink">Use {view.invited_email} — the invitation is for that address.</p>
        </div>
      )}

      {signedInEmail && !matches && (
        <div className="mt-6" data-audit="invite-mismatch">
          <p className="font-dm-sans text-[16px] leading-relaxed text-forest-green">
            This invitation is for <span className="font-semibold">{view.invited_email}</span>. You are signed in as <span className="font-semibold">{signedInEmail}</span>, so it can&rsquo;t be accepted from this account.
          </p>
          <Button type="button" variant="secondary" className="mt-3" onClick={signOutAndSwitch}>Sign out and use {view.invited_email}</Button>
        </div>
      )}

      {signedInEmail && matches && (
        <div className="mt-6" role="status" aria-live="polite" data-audit="invite-joining">
          {state === 'joining' || state === 'idle' ? <p className="font-dm-sans text-[16px] text-forest-green">Joining {ranch}…</p>
            : state === 'joined' ? <p className="font-dm-sans text-[16px] text-forest-green">You&rsquo;re in. Opening {ranch}…</p>
            : (
              <>
                <p className="font-dm-sans text-[16px] font-medium text-warning" role="alert">{error}</p>
                <Button type="button" className="mt-3" onClick={join}>Try again</Button>
              </>
            )}
        </div>
      )}
    </Card>
  )
}
