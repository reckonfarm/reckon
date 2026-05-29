'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

interface ThreadSummary {
  id: number
  listing_id: number
  role: 'buyer' | 'seller'
  counterparty_name: string | null
  listing_hay_type: string | null
  listing_county: string | null
  listing_sold_at: string | null
  closed_status: string
  last_message_at: string
  last_snippet: string | null
  unread: number
}

interface ThreadMessage {
  id: number
  sender_user_id: string
  body: string | null
  message_type: string
  offer_price_per_ton: number | null
  offer_tonnage: number | null
  offer_status: string | null
  created_at: string
}

interface ThreadMeta {
  id: number
  listing_id: number
  role: 'buyer' | 'seller'
  buyer_user_id: string
  seller_user_id: string
  counterparty_name: string | null
  listing_hay_type: string | null
  listing_county: string | null
  listing_sold_at: string | null
  closed_status: string
}

const INPUT_CLS =
  'w-full rounded-xl border border-forest-green/20 bg-white px-4 py-2.5 text-sm font-dm-sans text-forest-green placeholder-forest-green/40 focus:outline-none focus:ring-2 focus:ring-forest-green/30'

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function MessagesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const threadParam = searchParams.get('thread')

  const [authed, setAuthed]   = useState<boolean | null>(null)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(threadParam ? Number(threadParam) : null)

  const [meta, setMeta] = useState<ThreadMeta | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showOffer, setShowOffer] = useState(false)
  const [offerPrice, setOfferPrice] = useState('')
  const [offerTons, setOfferTons]   = useState('')
  const [counteringId, setCounteringId] = useState<number | null>(null)
  const [counterPrice, setCounterPrice] = useState('')
  const [counterTons, setCounterTons]   = useState('')
  const [acting, setActing] = useState(false)
  const [error, setError]   = useState('')

  const streamRef = useRef<HTMLDivElement | null>(null)

  const loadThreads = useCallback(() => {
    return fetch('/api/threads').then(r => r.ok ? r.json() : []).then((d: ThreadSummary[]) => {
      setThreads(Array.isArray(d) ? d : [])
    }).catch(() => {})
  }, [])

  const loadThread = useCallback((id: number) => {
    // Full refetch (after=null) so offer-status changes and system lines stay correct.
    return fetch(`/api/threads/${id}/messages`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { meta: ThreadMeta; messages: ThreadMessage[] } | null) => {
        if (d) { setMeta(d.meta); setMessages(d.messages) }
      })
      .catch(() => {})
  }, [])

  // Auth + initial thread list
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setAuthed(!!user)
      if (user) loadThreads()
    })
  }, [loadThreads])

  // Open thread + 15s polling (cleared on unmount / thread change)
  useEffect(() => {
    if (selectedId == null || authed !== true) return
    setLoadingThread(true)
    loadThread(selectedId).finally(() => setLoadingThread(false))
    const interval = setInterval(() => {
      loadThread(selectedId)
      loadThreads()  // keep list unread/snippet fresh
    }, 15000)
    return () => clearInterval(interval)
  }, [selectedId, authed, loadThread, loadThreads])

  // Auto-scroll to newest
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
  }, [messages])

  function openThread(id: number) {
    setSelectedId(id)
    setMeta(null); setMessages([]); setError('')
    router.replace(`/messages?thread=${id}`, { scroll: false })
  }
  function backToList() {
    setSelectedId(null); setMeta(null); setMessages([])
    router.replace('/messages', { scroll: false })
    loadThreads()
  }

  const myUserId = meta ? (meta.role === 'buyer' ? meta.buyer_user_id : meta.seller_user_id) : null
  const isClosed = meta?.closed_status === 'closed'
  const isDeclined = meta?.closed_status === 'declined'
  const canInteract = !!meta && !isClosed && !isDeclined

  async function sendText() {
    if (!selectedId || !text.trim()) return
    setSending(true); setError('')
    try {
      const res = await fetch(`/api/threads/${selectedId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text.trim() }),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Could not send.'); return }
      setText('')
      await loadThread(selectedId)
    } finally { setSending(false) }
  }

  async function sendOffer() {
    if (!selectedId) return
    if (!offerPrice && !offerTons) { setError('Enter a price and/or tonnage.'); return }
    setSending(true); setError('')
    try {
      const res = await fetch(`/api/threads/${selectedId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer_price_per_ton: offerPrice ? Number(offerPrice) : null,
          offer_tonnage: offerTons ? Number(offerTons) : null,
        }),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Could not send offer.'); return }
      setShowOffer(false); setOfferPrice(''); setOfferTons('')
      await loadThread(selectedId)
    } finally { setSending(false) }
  }

  async function offerAction(messageId: number, action: 'accept' | 'counter' | 'decline') {
    if (!selectedId) return
    setActing(true); setError('')
    try {
      const payload: Record<string, unknown> = { action }
      if (action === 'counter') {
        payload.offer_price_per_ton = counterPrice ? Number(counterPrice) : null
        payload.offer_tonnage = counterTons ? Number(counterTons) : null
      }
      const res = await fetch(`/api/threads/${selectedId}/offers/${messageId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Could not update offer.'); return }
      setCounteringId(null); setCounterPrice(''); setCounterTons('')
      await loadThread(selectedId)
    } finally { setActing(false) }
  }

  async function doClose() {
    if (!selectedId) return
    setActing(true); setError('')
    try {
      const res = await fetch(`/api/threads/${selectedId}/close`, { method: 'POST' })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Could not close.'); return }
      await loadThread(selectedId)
      await loadThreads()
    } finally { setActing(false) }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (authed === null) {
    return <><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-10 sm:px-6"><p className="text-sm text-forest-green/50 font-dm-sans">Loading…</p></main></>
  }
  if (!authed) {
    return (
      <><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 text-center">
        <p className="font-fraunces text-xl font-semibold text-forest-green">Your messages</p>
        <p className="mt-2 text-sm text-forest-green/60 font-dm-sans">Sign in to message buyers and sellers and make offers.</p>
        <a href="/signin" className="mt-4 inline-block rounded-lg bg-forest-green px-6 py-3 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors">Sign in</a>
      </main></>
    )
  }

  // Thread list view
  if (selectedId == null) {
    return (
      <><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">Messages</h1>
        <p className="mt-1 text-sm text-forest-green/50 font-dm-sans">Private conversations and offers with buyers and sellers.</p>
        {threads.length === 0 ? (
          <div className="mt-6 rounded-xl border-2 border-dashed border-forest-green/20 bg-white px-6 py-12 text-center">
            <p className="font-dm-sans text-sm text-forest-green/55">
              No conversations yet. Open a listing on the{' '}
              <Link href="/hay" className="underline hover:text-forest-green">Hay Network</Link> and tap &ldquo;Message&rdquo; to start one.
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-2">
            {threads.map(t => (
              <li key={t.id}>
                <button onClick={() => openThread(t.id)} className="w-full rounded-xl border border-forest-green/10 bg-white px-4 py-3 text-left shadow-sm hover:bg-cream/50 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-dm-sans text-sm font-semibold text-forest-green truncate">
                      {t.counterparty_name ?? 'Dryline member'}
                      <span className="ml-2 font-normal text-forest-green/45">
                        {t.listing_hay_type ?? 'Hay'}{t.listing_county ? ` · ${t.listing_county}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {t.closed_status === 'closed' && <span className="rounded-full bg-forest-green/10 px-2 py-0.5 text-[10px] font-medium font-dm-sans text-forest-green">Closed</span>}
                      {t.closed_status === 'declined' && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium font-dm-sans text-gray-500">Ended</span>}
                      {t.unread > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rust px-1.5 text-[10px] font-semibold text-white">{t.unread}</span>}
                    </span>
                  </div>
                  {t.last_snippet && <p className="mt-0.5 font-dm-sans text-xs text-forest-green/55 truncate">{t.last_snippet}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main></>
    )
  }

  // Conversation view
  return (
    <><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <button onClick={backToList} className="mb-4 inline-flex items-center gap-1 text-sm font-dm-sans text-forest-green/60 hover:text-forest-green transition-colors">
        ← All messages
      </button>

      {meta && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-fraunces text-lg font-semibold text-forest-green">{meta.counterparty_name ?? 'Dryline member'}</h1>
            <Link href={`/hay/${meta.listing_id}`} className="font-dm-sans text-xs text-forest-green/55 underline hover:text-forest-green">
              {meta.listing_hay_type ?? 'Hay'}{meta.listing_county ? ` · ${meta.listing_county}` : ''}
            </Link>
          </div>
          {canInteract && (
            <button onClick={doClose} disabled={acting}
              className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-xs font-medium text-forest-green hover:bg-cream disabled:opacity-50">
              Mark as closed
            </button>
          )}
        </div>
      )}

      {/* Status banners */}
      {isClosed && (
        <div className="mb-3 rounded-xl border border-forest-green/15 bg-forest-green/5 px-4 py-3">
          <p className="font-dm-sans text-sm font-medium text-forest-green">Deal closed.</p>
          <Link href={`/hay/${meta?.listing_id}`} className="mt-1 inline-block font-dm-sans text-sm text-forest-green underline hover:text-forest-green/70">
            Leave a review →
          </Link>
        </div>
      )}
      {isDeclined && (
        <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="font-dm-sans text-sm text-gray-600">This listing was sold to another buyer.</p>
        </div>
      )}
      {meta && !isClosed && !isDeclined && (meta.closed_status === 'buyer_marked' || meta.closed_status === 'seller_marked') && (
        <div className="mb-3 rounded-xl border border-forest-green/15 bg-cream px-4 py-2.5">
          <p className="font-dm-sans text-xs text-forest-green/70">
            {(meta.closed_status === 'buyer_marked') === (meta.role === 'buyer')
              ? 'You marked this closed — waiting for the other party to confirm.'
              : 'The other party marked this closed. Tap “Mark as closed” to confirm the deal.'}
          </p>
        </div>
      )}

      {/* Message stream */}
      <div ref={streamRef} className="mb-4 max-h-[55vh] space-y-3 overflow-y-auto rounded-xl border border-forest-green/10 bg-white px-4 py-4">
        {loadingThread && messages.length === 0 ? (
          <p className="text-sm text-forest-green/40 font-dm-sans">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-forest-green/40 font-dm-sans">No messages yet — say hello.</p>
        ) : messages.map(m => {
          const mine = m.sender_user_id === myUserId
          if (m.message_type === 'system') {
            return <p key={m.id} className="text-center font-dm-sans text-xs text-forest-green/45">{m.body}</p>
          }
          if (m.message_type === 'offer') {
            const canAct = canInteract && m.offer_status === 'pending' && !mine
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%] rounded-xl border border-rust/25 bg-rust/5 px-4 py-3">
                  <p className="font-dm-sans text-xs font-semibold uppercase tracking-wide text-rust">Offer</p>
                  <p className="mt-0.5 font-fraunces text-lg font-semibold text-forest-green">
                    {m.offer_price_per_ton != null ? `$${m.offer_price_per_ton}/ton` : 'Price open'}
                    {m.offer_tonnage != null && <span className="font-dm-sans text-sm font-normal text-forest-green/60"> · {m.offer_tonnage} tons</span>}
                  </p>
                  {m.offer_status && m.offer_status !== 'pending' && (
                    <p className="mt-1 font-dm-sans text-xs font-medium text-forest-green/60 capitalize">{m.offer_status}</p>
                  )}
                  {m.offer_status === 'pending' && mine && (
                    <p className="mt-1 font-dm-sans text-xs text-forest-green/45">Waiting for a response…</p>
                  )}
                  {canAct && counteringId !== m.id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => offerAction(m.id, 'accept')} disabled={acting}
                        className="rounded-lg bg-forest-green px-3 py-1.5 font-dm-sans text-xs font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50">Accept</button>
                      <button onClick={() => { setCounteringId(m.id); setCounterPrice(m.offer_price_per_ton?.toString() ?? ''); setCounterTons(m.offer_tonnage?.toString() ?? '') }} disabled={acting}
                        className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-xs font-medium text-forest-green hover:bg-cream disabled:opacity-50">Counter</button>
                      <button onClick={() => offerAction(m.id, 'decline')} disabled={acting}
                        className="rounded-lg border border-rust/30 px-3 py-1.5 font-dm-sans text-xs font-medium text-rust hover:bg-rust/5 disabled:opacity-50">Decline</button>
                    </div>
                  )}
                  {canAct && counteringId === m.id && (
                    <div className="mt-2 space-y-2">
                      <div className="flex gap-2">
                        <input type="number" min="0" value={counterPrice} onChange={e => setCounterPrice(e.target.value)} placeholder="$/ton" className={`${INPUT_CLS} py-1.5`} />
                        <input type="number" min="0" value={counterTons} onChange={e => setCounterTons(e.target.value)} placeholder="tons" className={`${INPUT_CLS} py-1.5`} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => offerAction(m.id, 'counter')} disabled={acting}
                          className="rounded-lg bg-forest-green px-3 py-1.5 font-dm-sans text-xs font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50">Send counter</button>
                        <button onClick={() => setCounteringId(null)} className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-xs font-medium text-forest-green hover:bg-cream">Cancel</button>
                      </div>
                    </div>
                  )}
                  <p className="mt-1 font-dm-sans text-[10px] text-forest-green/35">{timeOf(m.created_at)}</p>
                </div>
              </div>
            )
          }
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-2 ${mine ? 'bg-forest-green text-cream' : 'bg-forest-green/8 text-forest-green'}`}>
                <p className="font-dm-sans text-sm whitespace-pre-wrap">{m.body}</p>
                <p className={`mt-0.5 font-dm-sans text-[10px] ${mine ? 'text-cream/60' : 'text-forest-green/40'}`}>{timeOf(m.created_at)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="mb-2 font-dm-sans text-sm text-rust">{error}</p>}

      {/* Composer */}
      {canInteract ? (
        <div className="rounded-xl border border-forest-green/10 bg-white px-4 py-3 shadow-sm">
          {showOffer ? (
            <div className="space-y-2">
              <p className="font-dm-sans text-xs font-semibold uppercase tracking-wide text-forest-green/50">Make an offer</p>
              <div className="flex gap-2">
                <input type="number" min="0" value={offerPrice} onChange={e => setOfferPrice(e.target.value)} placeholder="$/ton" className={INPUT_CLS} />
                <input type="number" min="0" value={offerTons} onChange={e => setOfferTons(e.target.value)} placeholder="tons" className={INPUT_CLS} />
              </div>
              <div className="flex gap-2">
                <button onClick={sendOffer} disabled={sending}
                  className="rounded-lg bg-forest-green px-4 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50">
                  {sending ? 'Sending…' : 'Send offer'}
                </button>
                <button onClick={() => { setShowOffer(false); setOfferPrice(''); setOfferTons('') }}
                  className="rounded-lg border border-forest-green/20 px-4 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-cream">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="Write a message…"
                className={`${INPUT_CLS} resize-none`}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() } }} />
              <button onClick={() => setShowOffer(true)} className="shrink-0 rounded-lg border border-forest-green/20 px-3 py-2.5 font-dm-sans text-xs font-medium text-forest-green hover:bg-cream">$ Offer</button>
              <button onClick={sendText} disabled={sending || !text.trim()}
                className="shrink-0 rounded-lg bg-forest-green px-4 py-2.5 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50">
                {sending ? '…' : 'Send'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="font-dm-sans text-xs text-forest-green/45">This conversation is closed.</p>
      )}
    </main></>
  )
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-10 sm:px-6" /></>}>
      <MessagesInner />
    </Suspense>
  )
}
