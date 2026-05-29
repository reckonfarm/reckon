import 'server-only'
import { createServiceClient } from './supabase'
import { sendMessageNotification } from './email'

// ─── Config ──────────────────────────────────────────────────────────────────

const AWAY_MS = 10 * 60 * 1000   // recipient is "away" if they haven't read in 10 min

type DbClient = ReturnType<typeof createServiceClient>

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThreadSummary {
  id:               number
  listing_id:       number
  role:             'buyer' | 'seller'   // the current user's role in this thread
  counterparty_name: string | null
  listing_hay_type: string | null
  listing_county:   string | null        // "Name, ST"
  listing_sold_at:  string | null
  closed_status:    string
  last_message_at:  string
  last_snippet:     string | null
  unread:           number
}

export interface ThreadMessage {
  id:                  number
  sender_user_id:      string
  body:                string | null
  message_type:        string
  offer_price_per_ton: number | null
  offer_tonnage:       number | null
  offer_status:        string | null
  created_at:          string
}

export interface ThreadMeta {
  id:            number
  listing_id:    number
  role:          'buyer' | 'seller'
  buyer_user_id: string
  seller_user_id: string
  counterparty_name: string | null
  listing_hay_type: string | null
  listing_county:   string | null
  listing_sold_at:  string | null
  closed_status:    string
}

interface ThreadRow {
  id:                  number
  listing_id:          number
  buyer_user_id:       string
  seller_user_id:      string
  closed_status:       string
  last_message_at:     string
  buyer_last_read_at:  string | null
  seller_last_read_at: string | null
}

const SNIPPET_MAX = 90

function snippet(m: { message_type: string; body: string | null; offer_price_per_ton: number | null; offer_tonnage: number | null } | undefined): string | null {
  if (!m) return null
  if (m.message_type === 'offer') {
    const price = m.offer_price_per_ton != null ? `$${m.offer_price_per_ton}/ton` : 'offer'
    const tons = m.offer_tonnage != null ? ` · ${m.offer_tonnage} tons` : ''
    return `Offer: ${price}${tons}`
  }
  return (m.body ?? '').slice(0, SNIPPET_MAX) || null
}

// ─── Authorization helper ──────────────────────────────────────────────────────

async function loadThreadFor(db: DbClient, threadId: number, userId: string): Promise<ThreadRow | null> {
  const { data } = await db
    .from('hay_threads')
    .select('id, listing_id, buyer_user_id, seller_user_id, closed_status, last_message_at, buyer_last_read_at, seller_last_read_at')
    .eq('id', threadId)
    .single()
  if (!data) return null
  const t = data as ThreadRow
  if (t.buyer_user_id !== userId && t.seller_user_id !== userId) return null  // not a party
  return t
}

async function nameOf(db: DbClient, userId: string): Promise<string | null> {
  const { data } = await db.from('profiles').select('display_name').eq('id', userId).single()
  return (data?.display_name as string | null) ?? null
}

// ─── Create / open a thread ─────────────────────────────────────────────────────

export async function getOrCreateThread(
  listingId: number,
  initiatorId: string,
): Promise<{ id: number; created: boolean } | { error: string; status: number }> {
  const db = createServiceClient()

  const { data: listing } = await db
    .from('hay_listings')
    .select('id, user_id, active, sold_at')
    .eq('id', listingId)
    .single()

  if (!listing) return { error: 'Listing not found', status: 404 }
  if (listing.user_id === initiatorId) return { error: 'You cannot message your own listing', status: 403 }

  // Seller is always the listing owner; the initiator is the "buyer" side.
  const { data: existing } = await db
    .from('hay_threads')
    .select('id')
    .eq('listing_id', listingId)
    .eq('buyer_user_id', initiatorId)
    .maybeSingle()

  if (existing) return { id: existing.id as number, created: false }

  if (!listing.active || listing.sold_at != null) {
    return { error: 'This listing is no longer available', status: 409 }
  }

  const { data: inserted, error } = await db
    .from('hay_threads')
    .insert({ listing_id: listingId, buyer_user_id: initiatorId, seller_user_id: listing.user_id })
    .select('id')
    .single()

  if (error || !inserted) return { error: error?.message ?? 'Could not open thread', status: 500 }
  return { id: inserted.id as number, created: true }
}

// ─── Thread list (for /messages and unread badge) ───────────────────────────────

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const db = createServiceClient()

  const { data: threadData } = await db
    .from('hay_threads')
    .select('id, listing_id, buyer_user_id, seller_user_id, closed_status, last_message_at, buyer_last_read_at, seller_last_read_at, hay_listings(hay_type, sold_at, counties(name, state))')
    .or(`buyer_user_id.eq.${userId},seller_user_id.eq.${userId}`)
    .order('last_message_at', { ascending: false })

  const threads = (threadData ?? []) as unknown as Array<ThreadRow & {
    hay_listings: { hay_type: string | null; sold_at: string | null; counties: { name: string; state: string } | null } | null
  }>
  if (threads.length === 0) return []

  // Counterparty names (batch)
  const otherIds = [...new Set(threads.map(t => t.buyer_user_id === userId ? t.seller_user_id : t.buyer_user_id))]
  const nameById: Record<string, string | null> = {}
  if (otherIds.length > 0) {
    const { data: profs } = await db.from('profiles').select('id, display_name').in('id', otherIds)
    for (const p of (profs ?? []) as { id: string; display_name: string | null }[]) nameById[p.id] = p.display_name
  }

  // Messages for these threads (small scale; sorted desc so [0] per thread is latest)
  const threadIds = threads.map(t => t.id)
  const { data: msgData } = await db
    .from('hay_messages')
    .select('id, thread_id, sender_user_id, body, message_type, offer_price_per_ton, offer_tonnage, created_at')
    .in('thread_id', threadIds)
    .order('id', { ascending: false })

  const msgsByThread: Record<number, Array<{ id: number; sender_user_id: string; body: string | null; message_type: string; offer_price_per_ton: number | null; offer_tonnage: number | null; created_at: string }>> = {}
  for (const m of (msgData ?? []) as Array<{ thread_id: number } & { id: number; sender_user_id: string; body: string | null; message_type: string; offer_price_per_ton: number | null; offer_tonnage: number | null; created_at: string }>) {
    (msgsByThread[m.thread_id] ??= []).push(m)
  }

  return threads.map(t => {
    const role: 'buyer' | 'seller' = t.buyer_user_id === userId ? 'buyer' : 'seller'
    const myLastRead = role === 'buyer' ? t.buyer_last_read_at : t.seller_last_read_at
    const lastReadMs = myLastRead ? new Date(myLastRead).getTime() : 0
    const msgs = msgsByThread[t.id] ?? []
    const unread = msgs.filter(m => m.sender_user_id !== userId && new Date(m.created_at).getTime() > lastReadMs).length
    const county = t.hay_listings?.counties
    return {
      id:                t.id,
      listing_id:        t.listing_id,
      role,
      counterparty_name: nameById[role === 'buyer' ? t.seller_user_id : t.buyer_user_id] ?? null,
      listing_hay_type:  t.hay_listings?.hay_type ?? null,
      listing_county:    county ? `${county.name}, ${county.state}` : null,
      listing_sold_at:   t.hay_listings?.sold_at ?? null,
      closed_status:     t.closed_status,
      last_message_at:   t.last_message_at,
      last_snippet:      snippet(msgs[0]),
      unread,
    }
  })
}

export async function unreadCount(userId: string): Promise<number> {
  const threads = await listThreads(userId)
  return threads.reduce((sum, t) => sum + t.unread, 0)
}

// ─── Fetch messages (and mark the caller's read cursor) ─────────────────────────

export async function getThreadMessages(
  threadId: number,
  userId: string,
  afterId: number | null,
): Promise<{ meta: ThreadMeta; messages: ThreadMessage[] } | { error: string; status: number }> {
  const db = createServiceClient()
  const t = await loadThreadFor(db, threadId, userId)
  if (!t) return { error: 'Thread not found', status: 404 }

  let q = db
    .from('hay_messages')
    .select('id, sender_user_id, body, message_type, offer_price_per_ton, offer_tonnage, offer_status, created_at')
    .eq('thread_id', threadId)
    .order('id', { ascending: true })
  if (afterId != null) q = q.gt('id', afterId)

  const { data: msgs } = await q
  const messages = (msgs ?? []) as ThreadMessage[]

  // Mark read = now for the caller's side (so they're "present", not "away").
  const role: 'buyer' | 'seller' = t.buyer_user_id === userId ? 'buyer' : 'seller'
  const readCol = role === 'buyer' ? 'buyer_last_read_at' : 'seller_last_read_at'
  await db.from('hay_threads').update({ [readCol]: new Date().toISOString() }).eq('id', threadId)

  const otherId = role === 'buyer' ? t.seller_user_id : t.buyer_user_id

  // Listing meta for the header
  const { data: listing } = await db
    .from('hay_listings')
    .select('hay_type, sold_at, counties(name, state)')
    .eq('id', t.listing_id)
    .single()
  const lc = (listing as unknown as { counties: { name: string; state: string } | null } | null)?.counties

  const meta: ThreadMeta = {
    id:                t.id,
    listing_id:        t.listing_id,
    role,
    buyer_user_id:     t.buyer_user_id,
    seller_user_id:    t.seller_user_id,
    counterparty_name: await nameOf(db, otherId),
    listing_hay_type:  (listing?.hay_type as string | null) ?? null,
    listing_county:    lc ? `${lc.name}, ${lc.state}` : null,
    listing_sold_at:   (listing?.sold_at as string | null) ?? null,
    closed_status:     t.closed_status,
  }

  return { meta, messages }
}

// ─── Away + first-unread notification debounce ──────────────────────────────────

async function maybeNotify(
  db: DbClient,
  t: ThreadRow,
  senderId: string,
  newMessageId: number,
): Promise<void> {
  const recipientId = t.buyer_user_id === senderId ? t.seller_user_id : t.buyer_user_id
  const recipientLastRead = t.buyer_user_id === recipientId ? t.buyer_last_read_at : t.seller_last_read_at
  const lastReadMs = recipientLastRead ? new Date(recipientLastRead).getTime() : 0

  // Away: never read, or not in the last 10 minutes.
  const away = Date.now() - lastReadMs > AWAY_MS
  if (!away) return

  // First-unread: no earlier message the recipient hasn't seen (prevents per-message floods).
  const { count: priorUnread } = await db
    .from('hay_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', t.id)
    .neq('sender_user_id', recipientId)
    .lt('id', newMessageId)
    .gt('created_at', new Date(lastReadMs).toISOString())
  if ((priorUnread ?? 0) > 0) return

  const { data: prof } = await db.from('profiles').select('email').eq('id', recipientId).single()
  const email = prof?.email as string | null
  if (!email) return

  const senderName = (await nameOf(db, senderId)) ?? 'A Dryline member'
  const { data: listing } = await db.from('hay_listings').select('hay_type').eq('id', t.listing_id).single()
  const { data: msg } = await db
    .from('hay_messages')
    .select('body, message_type, offer_price_per_ton, offer_tonnage')
    .eq('id', newMessageId)
    .single()

  await sendMessageNotification({
    to:          email,
    senderName,
    hayType:     (listing?.hay_type as string | null) ?? null,
    snippet:     snippet(msg as { message_type: string; body: string | null; offer_price_per_ton: number | null; offer_tonnage: number | null }) ?? 'New message',
    threadId:    t.id,
  })
}

// ─── Post a message or offer ─────────────────────────────────────────────────────

interface PostPayload {
  body?: string | null
  offer_price_per_ton?: number | null
  offer_tonnage?: number | null
}

export async function postMessage(
  threadId: number,
  userId: string,
  payload: PostPayload,
): Promise<{ id: number } | { error: string; status: number }> {
  const db = createServiceClient()
  const t = await loadThreadFor(db, threadId, userId)
  if (!t) return { error: 'Thread not found', status: 404 }
  if (t.closed_status === 'closed' || t.closed_status === 'declined') {
    return { error: 'This conversation is closed', status: 409 }
  }

  const isOffer = payload.offer_price_per_ton != null || payload.offer_tonnage != null
  const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 2000) : null

  if (!isOffer && !body) return { error: 'Message body is required', status: 400 }
  if (isOffer && payload.offer_price_per_ton != null && payload.offer_price_per_ton < 0) {
    return { error: 'Offer price must be ≥ 0', status: 400 }
  }

  const insertRow = {
    thread_id:           threadId,
    sender_user_id:      userId,
    body:                body || null,
    message_type:        isOffer ? 'offer' : 'text',
    offer_price_per_ton: isOffer ? (payload.offer_price_per_ton ?? null) : null,
    offer_tonnage:       isOffer ? (payload.offer_tonnage ?? null) : null,
    offer_status:        isOffer ? 'pending' : null,
  }

  const { data: msg, error } = await db.from('hay_messages').insert(insertRow).select('id').single()
  if (error || !msg) return { error: error?.message ?? 'Could not send', status: 500 }

  await db.from('hay_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId)

  // Notification is best-effort — never fail the send.
  try { await maybeNotify(db, t, userId, msg.id as number) } catch { /* email is non-critical */ }

  return { id: msg.id as number }
}

// ─── Act on an offer (accept / counter / decline) ────────────────────────────────

export async function actOnOffer(
  threadId: number,
  messageId: number,
  userId: string,
  action: 'accept' | 'counter' | 'decline',
  counter?: { offer_price_per_ton?: number | null; offer_tonnage?: number | null },
): Promise<{ ok: true } | { error: string; status: number }> {
  const db = createServiceClient()
  const t = await loadThreadFor(db, threadId, userId)
  if (!t) return { error: 'Thread not found', status: 404 }
  if (t.closed_status === 'closed' || t.closed_status === 'declined') {
    return { error: 'This conversation is closed', status: 409 }
  }

  const { data: offer } = await db
    .from('hay_messages')
    .select('id, thread_id, sender_user_id, message_type, offer_status, offer_price_per_ton, offer_tonnage')
    .eq('id', messageId)
    .single()

  if (!offer || offer.thread_id !== threadId || offer.message_type !== 'offer') {
    return { error: 'Offer not found', status: 404 }
  }
  if (offer.offer_status !== 'pending') {
    return { error: 'This offer has already been resolved', status: 409 }
  }
  // Only the OTHER party can act on an offer.
  if (offer.sender_user_id === userId) {
    return { error: 'You cannot act on your own offer', status: 403 }
  }

  if (action === 'accept' || action === 'decline') {
    await db.from('hay_messages').update({ offer_status: action === 'accept' ? 'accepted' : 'declined' }).eq('id', messageId)
    const line = action === 'accept'
      ? `Offer accepted: $${offer.offer_price_per_ton ?? '—'}/ton${offer.offer_tonnage != null ? ` · ${offer.offer_tonnage} tons` : ''}`
      : 'Offer declined'
    await db.from('hay_messages').insert({ thread_id: threadId, sender_user_id: userId, body: line, message_type: 'system' })
    await db.from('hay_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId)
    return { ok: true }
  }

  // counter: mark the prior offer countered, then post a new pending offer from this user
  await db.from('hay_messages').update({ offer_status: 'countered' }).eq('id', messageId)
  const { error: insErr } = await db.from('hay_messages').insert({
    thread_id: threadId, sender_user_id: userId, message_type: 'offer',
    offer_price_per_ton: counter?.offer_price_per_ton ?? null,
    offer_tonnage: counter?.offer_tonnage ?? null,
    offer_status: 'pending',
    body: null,
  })
  if (insErr) return { error: insErr.message, status: 500 }
  await db.from('hay_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId)
  return { ok: true }
}

// ─── Close the deal (mutual / qualifying) → finalize listing as sold ─────────────

export interface CloseOutcome {
  closed_status: string
  finalized:     boolean
  declined_reason?: 'already_sold'
}

export async function closeThread(
  threadId: number,
  userId: string,
): Promise<CloseOutcome | { error: string; status: number }> {
  const db = createServiceClient()
  const t = await loadThreadFor(db, threadId, userId)
  if (!t) return { error: 'Thread not found', status: 404 }
  if (t.closed_status === 'closed') return { closed_status: 'closed', finalized: false }
  if (t.closed_status === 'declined') return { closed_status: 'declined', finalized: false }

  const isSeller = t.seller_user_id === userId
  const myMark = isSeller ? 'seller_marked' : 'buyer_marked'
  const otherMark = isSeller ? 'buyer_marked' : 'seller_marked'

  // Qualifying to finalize: the other side already marked, OR the seller marks
  // and there is an accepted offer in the thread.
  let qualifies = t.closed_status === otherMark
  if (!qualifies && isSeller) {
    const { count } = await db
      .from('hay_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId)
      .eq('message_type', 'offer')
      .eq('offer_status', 'accepted')
    qualifies = (count ?? 0) > 0
  }

  if (!qualifies) {
    await db.from('hay_threads').update({ closed_status: myMark }).eq('id', threadId)
    return { closed_status: myMark, finalized: false }
  }

  // Finalize the listing as sold — mirrors /sold, guarded on sold_at null→set.
  const { data: updated } = await db
    .from('hay_listings')
    .update({
      sold_to_user_id: t.buyer_user_id,
      sold_at:         new Date().toISOString(),
      claim_status:    'confirmed',
      active:          false,
    })
    .eq('id', t.listing_id)
    .is('sold_at', null)
    .select('id')

  if (!updated || updated.length === 0) {
    // Another buyer's thread already closed this listing — this one loses.
    await db.from('hay_threads').update({ closed_status: 'declined' }).eq('id', threadId)
    await db.from('hay_messages').insert({
      thread_id: threadId, sender_user_id: userId, message_type: 'system',
      body: 'This listing was sold to another buyer.',
    })
    await db.from('hay_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId)
    return { closed_status: 'declined', finalized: false, declined_reason: 'already_sold' }
  }

  // total_sales += 1 for the seller (read-modify-write, same as /sold)
  const { data: prof } = await db.from('profiles').select('total_sales').eq('id', t.seller_user_id).single()
  await db.from('profiles').update({ total_sales: (prof?.total_sales ?? 0) + 1 }).eq('id', t.seller_user_id)

  await db.from('hay_threads').update({ closed_status: 'closed', last_message_at: new Date().toISOString() }).eq('id', threadId)
  await db.from('hay_messages').insert({
    thread_id: threadId, sender_user_id: userId, message_type: 'system',
    body: 'Deal marked closed. You can now review each other.',
  })

  return { closed_status: 'closed', finalized: true }
}
