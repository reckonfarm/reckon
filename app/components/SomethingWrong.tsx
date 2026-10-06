'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import BottomSheet from './BottomSheet'

// ─── "Something's wrong" — one tap, any screen (Session 1, pilot blocker 1) ──
// The flag sits in the header beside Account, so it is on every screen a
// member sees. It opens a sheet with one box. Send posts their words with the
// screen they were looking at — its path, its address and the text painted
// on it — and PK gets it by email the same minute. Nothing here is a record:
// it does not queue, it does not retry itself; a send that fails keeps the
// words on screen and says so, and the same Send is still there to tap.

type State = 'idle' | 'sending' | 'sent' | 'failed'

export default function SomethingWrong() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [words, setWords] = useState('')
  const [state, setState] = useState<State>('idle')

  async function send() {
    const message = words.trim()
    if (!message || state === 'sending') return
    setState('sending')
    // What they were looking at: the painted text of the screen behind the sheet, as far as the sheet.
    const main = document.querySelector('main') as HTMLElement | null
    const screen_text = (main?.innerText ?? document.body.innerText).replace(/\n{3,}/g, '\n\n').slice(0, 4000)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, page_path: pathname, url: location.href, screen_text, screen_width: innerWidth, standalone: matchMedia('(display-mode: standalone)').matches }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setState('sent')
      setWords('')
      setTimeout(() => { setOpen(false); setState('idle') }, 1800)
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setState('idle') }}
        className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-lg px-2 font-dm-sans text-[16px] font-medium text-forest-green hover:bg-forest-green/5 transition-colors sm:px-3"
        aria-label="Something's wrong"
        data-audit="something-wrong"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 22V4" />
          <path d="M4 4h12l-2 4 2 4H4" />
        </svg>
        <span className="hidden sm:inline">Something&rsquo;s wrong</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} label="Something's wrong" panelAudit="something-wrong-sheet">
        <div className="space-y-4 px-5 pb-6 pt-2">
          <p className="font-fraunces text-[22px] font-semibold leading-tight text-ink">Something&rsquo;s wrong?</p>
          <p className="font-dm-sans text-[16px] text-secondary-ink">PK gets this screen and your words.</p>
          <textarea
            value={words}
            onChange={e => setWords(e.target.value)}
            rows={4}
            placeholder="What happened, in your words"
            className="w-full rounded-xl border border-forest-green/20 bg-white px-4 py-3 font-dm-sans text-[17px] text-ink placeholder:text-secondary-ink/70 focus:border-forest-green focus:outline-none"
            data-audit="something-wrong-words"
            disabled={state === 'sending' || state === 'sent'}
          />
          {state === 'sent' && <p className="font-dm-sans text-[17px] font-semibold text-forest-green" role="status" data-audit="something-wrong-sent">Sent. PK will read it.</p>}
          {state === 'failed' && <p className="font-dm-sans text-[16px] text-rust" role="alert" data-audit="something-wrong-failed">Couldn&rsquo;t send. Your words are still here — tap Send again when you have signal.</p>}
          {state !== 'sent' && (
            <button
              type="button"
              onClick={send}
              disabled={state === 'sending' || !words.trim()}
              className="w-full min-h-[56px] rounded-xl bg-forest-green font-dm-sans text-[18px] font-semibold text-cream disabled:opacity-60"
              data-audit="something-wrong-send"
            >
              {state === 'sending' ? 'Sending…' : 'Send to PK'}
            </button>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
