'use client'

// ⚠️ TEMPORARY DIAGNOSTIC — remove once we've pinpointed the session-drop cause.
//
// Open this page in each context and report what it says:
//   (1) right after signing in,
//   (2) after closing & reopening via your texted SMS link (in-app browser),
//   (3) in regular Safari / Chrome,
//   (4) from the home-screen app (if you've Added to Home Screen).
// The combination tells us whether the session is being lost to an in-app
// browser's isolated/ephemeral cookie jar vs. a Supabase project session config.
// No personal data is shown (email is masked; tokens are never displayed).

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Evt = { t: string; event: string }

function maskEmail(email: string | undefined): string {
  if (!email) return '(none)'
  const [u, d] = email.split('@')
  return `${u.slice(0, 1)}***@${d ?? ''}`
}

function detectContext(): string {
  if (typeof navigator === 'undefined') return 'server'
  const ua = navigator.userAgent
  const tags: string[] = []
  // Home-screen PWA (persistent cookie store — the durable context).
  const standalone =
    (window.matchMedia?.('(display-mode: standalone)')?.matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  if (standalone) tags.push('STANDALONE (home-screen app)')
  // Known in-app/embedded browsers (isolated cookie jars).
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) tags.push('Facebook in-app')
  if (/Instagram/i.test(ua)) tags.push('Instagram in-app')
  if (/\bLine\//i.test(ua)) tags.push('LINE in-app')
  if (/MicroMessenger/i.test(ua)) tags.push('WeChat in-app')
  if (/GSA\//i.test(ua)) tags.push('Google-app in-app')
  if (/Twitter|TwitterAndroid/i.test(ua)) tags.push('Twitter in-app')
  const isIOS = /iPhone|iPad|iPod/i.test(ua)
  const isSafariUA = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)
  if (isIOS && isSafariUA && !standalone) {
    // Safari proper and the SMS-link "in-app Safari" sheet (SFSafariViewController)
    // share this UA but NOT the same cookie store — behavior, not UA, distinguishes them.
    tags.push('iOS Safari or in-app Safari sheet (UA cannot tell them apart)')
  }
  if (tags.length === 0) tags.push(isIOS ? 'iOS browser' : 'desktop/other browser')
  return tags.join(' · ')
}

export default function SessionDebugPage() {
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState<string | undefined>()
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [hasRefresh, setHasRefresh] = useState(false)
  const [context, setContext] = useState('')
  const [sbCookies, setSbCookies] = useState<string[]>([])
  const [events, setEvents] = useState<Evt[]>([])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    setContext(detectContext())
    // Supabase auth cookie NAMES only (never values).
    try {
      setSbCookies(
        document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => n.startsWith('sb-')),
      )
    } catch { /* ignore */ }

    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session
      setSignedIn(!!s)
      setEmail(s?.user?.email)
      setExpiresAt(s?.expires_at ?? null)
      setHasRefresh(!!s?.refresh_token)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setEvents(e => [{ t: new Date().toLocaleTimeString(), event }, ...e].slice(0, 12))
      setSignedIn(!!session)
      setEmail(session?.user?.email)
      setExpiresAt(session?.expires_at ?? null)
      setHasRefresh(!!session?.refresh_token)
    })
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => { subscription.unsubscribe(); clearInterval(iv) }
  }, [])

  const expiresLabel = expiresAt
    ? (() => {
        const secs = Math.round(expiresAt - now / 1000)
        return secs >= 0 ? `in ${Math.floor(secs / 60)}m ${secs % 60}s` : `EXPIRED ${Math.abs(Math.floor(secs / 60))}m ago`
      })()
    : '—'

  const Row = ({ k, v, ok }: { k: string; v: string; ok?: boolean }) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-forest-green/10 py-2">
      <span className="font-dm-sans text-sm text-forest-green/60">{k}</span>
      <span className={`font-dm-sans text-sm font-medium tabular-nums ${ok === true ? 'text-forest-green' : ok === false ? 'text-rust' : 'text-forest-green/80'}`}>{v}</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-cream px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="font-fraunces text-2xl font-semibold text-forest-green">Session check</h1>
        <p className="mt-1 font-dm-sans text-xs text-forest-green/50">
          Temporary diagnostic. Open this in each context (texted link, Safari, home-screen app) and tell Claude what it shows.
        </p>

        <div className="mt-6 rounded-xl border border-forest-green/10 bg-white px-5 py-3 shadow-sm">
          <Row k="Signed in?" v={loading ? 'checking…' : signedIn ? 'YES ✅' : 'NO ❌'} ok={loading ? undefined : signedIn} />
          <Row k="Account" v={maskEmail(email)} />
          <Row k="Access token" v={expiresLabel} ok={expiresAt ? (expiresAt - now / 1000 > 0) : undefined} />
          <Row k="Refresh token present" v={hasRefresh ? 'yes' : 'no'} ok={hasRefresh} />
          <Row k="Supabase cookies" v={sbCookies.length ? `${sbCookies.length} present` : 'NONE ❌'} ok={sbCookies.length > 0} />
          <Row k="Browser context" v={context} />
        </div>

        <div className="mt-4 rounded-xl border border-forest-green/10 bg-white px-5 py-3 shadow-sm">
          <p className="font-dm-sans text-xs font-medium uppercase tracking-wide text-forest-green/40">Auth events (live)</p>
          {events.length === 0 ? (
            <p className="mt-2 font-dm-sans text-sm text-forest-green/40">none yet</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {events.map((e, i) => (
                <li key={i} className="font-dm-sans text-xs text-forest-green/70 tabular-nums">{e.t} — {e.event}</li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-4 font-dm-sans text-xs leading-relaxed text-forest-green/50">
          If &quot;Supabase cookies: NONE&quot; right after signing in elsewhere, the cookies didn&apos;t carry into this
          context (isolated cookie jar). If cookies are present but &quot;Signed in: NO,&quot; the session was cleared or expired.
        </p>
      </div>
    </div>
  )
}
