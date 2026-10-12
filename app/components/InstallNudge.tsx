'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import BottomSheet from './BottomSheet'
import { IosSteps, AndroidSteps } from './install-art'
import { trackEvent } from '@/lib/analytics'
import { isInAppBrowser, isStandalone, phonePlatform, type PhonePlatform } from '@/lib/phone'
import { earned, noteCheck, noteDay, noteDismissed, noteInstalled, noteSave, quiet, type Moments } from '@/lib/install-moments'
import { useOutbox } from '@/lib/outbox'
import { useRecordSheetOpen } from '@/lib/record-sheet-state'
import { createClient } from '@/lib/supabase-browser'
import { useUndoOwnsTheSlot } from '@/lib/undo'

// ─── Put Dryline on your home screen — the one ask (Block 48, ruling R3) ─────
// A bottom sheet that opens by itself, once, after something useful happened
// on this phone (lib/install-moments says what counts). Never on a first page
// load, never inside the installed app, never for two weeks after "Not now",
// never over an Undo or an open record sheet — it closes for those and comes
// back at the next moment. Android gets the browser's own install prompt from
// our button; iPhone Safari gets the three steps with the two pictures; an
// iPhone inside Facebook, Messenger or Instagram, which cannot add anything to
// a home screen, is told to open Safari and given the link to carry over.
//
// Five numbers leave this component, for Vercel's event counter and nothing
// else: install_prompt_shown · install_accepted · install_dismissed ·
// appinstalled · standalone_session. Each carries the platform, never a name.

type Prompt = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
declare global { interface Window { __dlInstall?: Prompt | null } }

const SETTLE_MS = 1_500       // the page paints, the save strip says Sent, then the ask
const STANDALONE_SEEN = 'dryline_standalone_seen'

export default function InstallNudge() {
  const pathname = usePathname()
  const search = useSearchParams()
  // 'unknown' until the browser client has read the session: a county or
  // market check counts only for a phone that is KNOWN to be signed out.
  const [session, setSession] = useState<'unknown' | 'in' | 'out'>('unknown')
  const signedIn = session === 'in'
  const items = useOutbox()
  const undoOwns = useUndoOwnsTheSlot()
  const sheetOpen = useRecordSheetOpen()
  const [platform, setPlatform] = useState<PhonePlatform | null>(null)
  const [inApp, setInApp] = useState(false)
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState(false)
  const [copied, setCopied] = useState<'no' | 'yes' | 'show'>('no')
  const seenSynced = useRef<Set<string> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const standalone = useRef(false)

  // The phone, once. Inside the installed app this component counts one
  // session and is otherwise inert.
  useEffect(() => {
    standalone.current = isStandalone()
    if (standalone.current) {
      try {
        if (!sessionStorage.getItem(STANDALONE_SEEN)) { sessionStorage.setItem(STANDALONE_SEEN, '1'); trackEvent('standalone_session', { platform: phonePlatform(navigator.userAgent) ?? 'other' }) }
      } catch { trackEvent('standalone_session', { platform: phonePlatform(navigator.userAgent) ?? 'other' }) }
      return
    }
    setPlatform(phonePlatform(navigator.userAgent))
    setInApp(isInAppBrowser(navigator.userAgent))
    const onInstalled = () => { noteInstalled(); setOpen(false); trackEvent('appinstalled', { platform: phonePlatform(navigator.userAgent) ?? 'other' }) }
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  // Offer the ask a beat after a moment, if the phone has earned it and
  // nothing that outranks it is on screen.
  const consider = (m: Moments) => {
    if (standalone.current || open) return
    if (!earned(m, signedIn) || quiet(m)) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      setOpen(true)
      trackEvent('install_prompt_shown', { platform: phonePlatform(navigator.userAgent) ?? 'other', in_app: isInAppBrowser(navigator.userAgent) })
    }, SETTLE_MS)
  }

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => setSession(data.session?.user ? 'in' : 'out')).catch(() => setSession('out'))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s?.user ? 'in' : 'out'))
    return () => subscription.unsubscribe()
  }, [])

  // A day opened, and signed out, a county or market looked at.
  useEffect(() => {
    if (standalone.current || session === 'unknown') return
    let m = noteDay()
    const check = pathname === '/markets' || pathname.startsWith('/weather') || (pathname === '/dashboard' && search.has('fips'))
    if (session === 'out' && check) m = noteCheck()
    consider(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, session])

  // A save that reached the ranch while this was mounted. The ones already
  // synced when the page opened are history, not moments.
  useEffect(() => {
    if (standalone.current) return
    const synced = items.filter(i => i.state === 'synced').map(i => i.id)
    if (seenSynced.current === null) { seenSynced.current = new Set(synced); return }
    let m: Moments | null = null
    for (const id of synced) if (!seenSynced.current.has(id)) { seenSynced.current.add(id); m = noteSave() }
    if (m) consider(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // An Undo or a record sheet outranks the ask: the sheet steps aside while
  // either is up and comes back when it is gone. Read at paint time, not held
  // in state: the browser's prompt is there or it is not.
  const visible = open && !undoOwns && !sheetOpen
  const canPrompt = typeof window !== 'undefined' && !!window.__dlInstall
  if (!platform && !canPrompt) return null

  const notNow = () => {
    noteDismissed(); setOpen(false)
    trackEvent('install_dismissed', { platform: platform ?? 'other', in_app: inApp })
  }
  const install = async () => {
    const p = window.__dlInstall
    if (!p) return
    setAsked(true)
    try {
      await p.prompt()
      const { outcome } = await p.userChoice
      window.__dlInstall = null
      if (outcome === 'accepted') { noteInstalled(); trackEvent('install_accepted', { platform: platform ?? 'other' }); setOpen(false) }
      else { noteDismissed(); trackEvent('install_dismissed', { platform: platform ?? 'other', in_app: false, prompt: true }); setOpen(false) }
    } catch { setOpen(false) }
    setAsked(false)
  }
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied('yes'); setTimeout(() => setCopied('no'), 2_000) }
    catch { setCopied('show') }
  }

  const button = 'w-full min-h-[56px] rounded-xl font-dm-sans text-[18px] font-semibold'
  return (
    <BottomSheet open={visible} onClose={notNow} label="Put Dryline on your home screen" panelAudit="install-nudge" z={60}>
      <div className="space-y-5 px-5 pb-6 pt-2">
        <p className="font-fraunces text-[22px] font-semibold leading-tight text-ink">Put Dryline on your home screen.</p>
        <p className="font-dm-sans text-[17px] text-secondary-ink">Opens like an app, works with no signal.</p>
        {platform === 'ios' && inApp ? (
          <div className="space-y-3" data-audit="install-nudge-inapp">
            <p className="font-dm-sans text-[17px] text-ink">Open this in Safari to add it to your home screen.</p>
            <button type="button" onClick={copyLink} className={`${button} bg-forest-green text-cream`} data-audit="install-nudge-copy">
              {copied === 'yes' ? 'Copied' : 'Copy link'}
            </button>
            {copied === 'show' && <p className="break-all font-dm-sans text-[15px] text-secondary-ink" data-audit="install-nudge-link">{typeof window !== 'undefined' ? window.location.href : ''}</p>}
          </div>
        ) : platform === 'ios' ? (
          <IosSteps audit="install-nudge-steps" />
        ) : canPrompt ? (
          <button type="button" onClick={install} disabled={asked} className={`${button} bg-forest-green text-cream disabled:opacity-60`} data-audit="install-nudge-install">Add to home screen</button>
        ) : (
          <AndroidSteps audit="install-nudge-steps" />
        )}
        <button type="button" onClick={notNow} className={`${button} border border-forest-green/20 text-forest-green`} data-audit="install-nudge-not-now">Not now</button>
      </div>
    </BottomSheet>
  )
}
