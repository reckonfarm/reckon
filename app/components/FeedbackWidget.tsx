'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Sentiment = 'positive' | 'neutral' | 'negative'
type Status = 'idle' | 'sending' | 'done'

const SENTIMENTS: { value: Sentiment; emoji: string; label: string }[] = [
  { value: 'positive', emoji: '👍', label: 'Good' },
  { value: 'neutral', emoji: '😐', label: 'Meh' },
  { value: 'negative', emoji: '👎', label: 'Bad' },
]

// Session-scoped: dismissing hides it for this visit only. It quietly returns
// next visit — early on, every response matters, so we never lock the channel.
const DISMISS_KEY = 'dryline_feedback_dismissed'

export default function FeedbackWidget() {
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(true) // assume hidden until we read sessionStorage
  const [open, setOpen] = useState(false)
  const [sentiment, setSentiment] = useState<Sentiment | null>(null)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  // Mirror BottomTabBar: stay out of the auth flow.
  if (pathname.startsWith('/signin') || pathname.startsWith('/auth')) return null
  if (dismissed) return null

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* sessionStorage unavailable — just hide for now */
    }
    setDismissed(true)
  }

  function resetSoon() {
    closeTimer.current = setTimeout(() => {
      setOpen(false)
      // reset for a possible next submission after the panel has closed
      setTimeout(() => {
        setStatus('idle')
        setSentiment(null)
        setMessage('')
      }, 250)
    }, 2200)
  }

  async function submit() {
    if (status === 'sending') return
    if (!sentiment && !message.trim()) return
    setStatus('sending')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentiment,
          message: message.trim() || null,
          page_path: pathname,
          url: typeof window !== 'undefined' ? window.location.href : null,
        }),
      })
      if (!res.ok) throw new Error('failed')
      setStatus('done')
      resetSoon()
    } catch {
      setStatus('idle') // let them try again
    }
  }

  const canSend = (!!sentiment || message.trim().length > 0) && status === 'idle'

  return (
    // z-40 keeps it under the z-50 bottom nav. Mobile bottom offset clears the
    // 56px tab bar + safe-area; on md+ there is no bottom bar, so sit at the edge.
    <div className="fixed right-3 z-40 bottom-[calc(56px+env(safe-area-inset-bottom)+0.75rem)] md:right-4 md:bottom-4 font-dm-sans">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-forest-green/15 bg-cream px-4 py-2.5 text-sm font-medium text-forest-green shadow-lg shadow-forest-green/10 transition-transform hover:-translate-y-0.5"
          aria-label="Send feedback"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
          </svg>
          Feedback
        </button>
      ) : (
        <div className="w-[18rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-forest-green/15 bg-cream p-4 shadow-xl shadow-forest-green/15">
          {status === 'done' ? (
            <div className="py-2 text-center">
              <div className="mb-1 text-2xl">🌱</div>
              <p className="font-fraunces text-base text-forest-green">
                Thanks — I read every one of these.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-start justify-between">
                <p className="font-fraunces text-base leading-tight text-forest-green">
                  How&rsquo;s it going?
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded p-1 text-forest-green/40 transition-colors hover:text-forest-green/70"
                    aria-label="Close"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="6" y1="6" x2="18" y2="18" />
                      <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                  </button>
                  <button
                    onClick={dismiss}
                    className="rounded px-1.5 py-1 text-[11px] text-forest-green/40 transition-colors hover:text-forest-green/70"
                    aria-label="Hide feedback for this visit"
                  >
                    Hide
                  </button>
                </div>
              </div>

              <div className="mb-3 flex gap-2">
                {SENTIMENTS.map((s) => {
                  const active = sentiment === s.value
                  return (
                    <button
                      key={s.value}
                      onClick={() => setSentiment(active ? null : s.value)}
                      className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl border py-2 text-[11px] transition-colors ${
                        active
                          ? 'border-forest-green bg-forest-green/5 text-forest-green'
                          : 'border-forest-green/15 text-forest-green/55 hover:border-forest-green/30'
                      }`}
                      aria-pressed={active}
                    >
                      <span className="text-lg leading-none">{s.emoji}</span>
                      {s.label}
                    </button>
                  )
                })}
              </div>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Anything on your mind? (optional)"
                rows={3}
                maxLength={2000}
                className="mb-3 w-full resize-none rounded-xl border border-forest-green/15 bg-white/60 px-3 py-2 text-sm text-forest-green placeholder:text-forest-green/35 focus:border-forest-green/40 focus:outline-none"
              />

              <button
                onClick={submit}
                disabled={!canSend}
                style={{ backgroundColor: '#8B3A2B' }}
                className="w-full rounded-xl py-2.5 text-sm font-medium text-cream transition-opacity disabled:opacity-40"
              >
                {status === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
