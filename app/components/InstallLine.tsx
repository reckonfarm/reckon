'use client'

import { useState } from 'react'
import BottomSheet from './BottomSheet'
import { IosSteps, AndroidSteps } from './install-art'

// ─── Put Dryline on your home screen (Session 1, pilot blocker 2) ────────────
// A line under Help on Account for anyone. The tap opens the walkthrough for
// the phone in hand: iPhone gets Share → Add to Home Screen → Add with pictures
// of the two controls; Android gets the real install prompt when the browser
// offers one, and the menu steps when it does not.
// Block 48 (R3): the line Today used to paint on first load is gone — the ask
// is InstallNudge's now, after something useful happens. `where` stays so the
// two styles stay apart.

export type InstallPlatform = 'ios' | 'android'

type Prompt = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
declare global { interface Window { __dlInstall?: Prompt | null } }

export default function InstallLine({ platform, where }: { platform: InstallPlatform; where: 'today' | 'account' }) {
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState(false)
  const [installed, setInstalled] = useState<'no' | 'asked' | 'yes'>('no')
  if (gone) return null

  const notNow = () => {
    document.cookie = 'dl_install_later=1; path=/; max-age=1209600; samesite=lax'
    setOpen(false); setGone(true)
  }
  const install = async () => {
    const p = window.__dlInstall
    if (!p) return
    setInstalled('asked')
    await p.prompt()
    const { outcome } = await p.userChoice
    window.__dlInstall = null
    if (outcome === 'accepted') { setInstalled('yes'); document.cookie = 'dl_installed=1; path=/; max-age=31536000; samesite=lax' }
    else setInstalled('no')
  }
  const canPrompt = typeof window !== 'undefined' && !!window.__dlInstall

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={where === 'today'
          ? 'mb-4 flex w-full min-h-[56px] items-center gap-3 rounded-xl border border-forest-green/15 bg-white px-4 text-left font-dm-sans text-[17px] font-semibold text-forest-green'
          : 'inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2'}
        data-audit="install-line"
      >
        {where === 'today' && (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 8v7" /><path d="M9 12l3 3 3-3" /></svg>
        )}
        Put Dryline on your home screen{where === 'account' ? ' →' : ''}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} label="Put Dryline on your home screen" panelAudit="install-sheet">
        <div className="space-y-5 px-5 pb-6 pt-2">
          <p className="font-fraunces text-[22px] font-semibold leading-tight text-ink">Put Dryline on your home screen</p>
          <p className="font-dm-sans text-[16px] text-secondary-ink">It opens like an app, and it works in a corral with no signal.</p>
          {platform === 'ios' ? (
            <IosSteps audit="install-steps" />
          ) : installed === 'yes' ? (
            <p className="font-dm-sans text-[17px] font-semibold text-forest-green" data-audit="install-done">Dryline is on your home screen.</p>
          ) : canPrompt ? (
            <button type="button" onClick={install} disabled={installed === 'asked'} className="w-full min-h-[56px] rounded-xl bg-forest-green font-dm-sans text-[18px] font-semibold text-cream disabled:opacity-60" data-audit="install-prompt">Install</button>
          ) : (
            <AndroidSteps audit="install-steps" />
          )}
          {where === 'today' && (
            <button type="button" onClick={notNow} className="w-full min-h-[48px] rounded-xl border border-forest-green/20 font-dm-sans text-[16px] font-medium text-forest-green" data-audit="install-not-now">Not now</button>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
