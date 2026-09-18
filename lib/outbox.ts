'use client'

// ─── Outbox — every manual log entry is saved on the phone first ──────────────
//
// Block 2A. A tap on Save writes the entry HERE (localStorage) before anything
// touches the network, so "did that save?" always has an honest answer:
//
//   local   → "Saved on this phone"        the local write succeeded; nothing sent yet
//   queued  → "Waiting to sync"            an upload has been attempted or is pending
//   synced  → "Synced to ranch"            the server acknowledged the row
//   failed  → "Couldn't save — try again"  the server refused it (a 4xx) or the
//                                          local write itself failed (that case
//                                          throws from enqueue — the sheet says so)
//
// Every entry carries a client-minted UUID as its event id BEFORE the first
// attempt. Retries reuse it, the server inserts it as the primary key, and a
// second arrival of the same id is answered 200 (duplicate) — so a double-tap,
// a retry after a timed-out-but-landed write, or a force-quit mid-save can
// never produce two rows.
//
// Uploads are sequential and single-flight. Transient failures (no network,
// 5xx, 408, 429, a thrown fetch) leave the entry queued; it is retried when the
// browser comes back online, when the app returns to the foreground, on a slow
// timer while anything is pending, and on demand. A definitive refusal (other
// 4xx) marks it failed with the server's own message and stops retrying — the
// person fixes and re-saves, or discards.
//
// `holdUntil` (Block 2B undo): an entry may be held back from upload for a
// few seconds so "Undo" can pull it before anything leaves the phone. Undo on
// an entry that has already left is not offered — the ledger is append-only.
//
// This module is the ONLY writer of the outbox key. React reads it through
// useOutbox() (useSyncExternalStore) so every surface shows the same truth.

import { useSyncExternalStore } from 'react'
import { isQuotaError, makeRoomForRecords } from './local-space'

export type OutboxState = 'local' | 'queued' | 'synced' | 'failed'

export interface Consequence {
  lines: string[]
}

export interface OutboxItem {
  id: string                        // the event id (client UUID)
  body: Record<string, unknown>     // the /api/log request body, id included
  label: string                     // one-line human description ("Fed 4 bales")
  createdAt: number
  state: OutboxState
  attempts: number
  lastError?: string
  holdUntil?: number                // ms epoch; no upload before this (dwell, or the undo window)
  undoable?: boolean                // an explicit undo window was asked for (Repeat last)
  syncedAt?: number
  consequence?: Consequence         // what the server said it meant (2C)
  serverId?: string
  owner?: string                    // the signed-in user id this entry was saved under (Block 5D)
  // Block 7A: a place captured in the field goes through this same outbox.
  // `endpoint` is where the body is POSTed (default /api/log — every entry
  // before 7A); `link` is where the receipt's "Open …" goes, when the thing
  // recorded is not an entry on the activity record.
  endpoint?: string
  link?: { href: string; label: string }
  // Block 14: one thing the server offers AFTER an entry lands — "Change bunch
  // to 274?" on a count that differed. Data, not a function: the strip knows
  // what each kind means. Cleared once taken or declined.
  followUp?: FollowUp
}

export type FollowUp = { kind: 'set_head'; lot_id: string; head: number; label: string; done?: boolean }

export const STATE_LABEL: Record<OutboxState, string> = {
  // Block 15 (ruling 4): four words, never a sentence.
  local:  'Saved',
  queued: 'Waiting for signal',
  synced: 'Sent',
  failed: "Couldn't send",
}

const KEY = 'dryline_outbox_v1'
// Block 5D: the user id the phone's private state belongs to (written by
// lib/private-state on every auth change). An entry saved under one person is
// never uploaded under another — the guard in flush() below.
export const OWNER_KEY = 'dryline_session_uid'
const ownerNow = (): string | null => { try { return localStorage.getItem(OWNER_KEY) } catch { return null } }
const SYNCED_TTL_MS = 6 * 60 * 60 * 1000   // synced entries linger for the status line, then drop
const RETRY_TIMER_MS = 20_000
const MAX_ITEMS = 200
// Minimum dwell in each state, enforced HERE so the four states are real
// stored states that every surface sees in order — never a render-side trick.
// 'local' holds at least this long before the first upload; 'queued' holds at
// least this long before 'synced' is written.
export const MIN_DWELL_MS = 600

// ─── Storage ──────────────────────────────────────────────────────────────────

let cache: OutboxItem[] | null = null
const listeners = new Set<() => void>()

function read(): OutboxItem[] {
  if (cache) return cache
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    cache = Array.isArray(parsed) ? (parsed as OutboxItem[]).filter(i => i && typeof i.id === 'string') : []
  } catch {
    cache = []
  }
  return cache
}

// Throws when the phone refuses the write (quota, private mode) — the caller
// must say so; a save that did not reach the phone is not "saved".
function write(items: OutboxItem[]): void {
  const now = Date.now()
  // Block 15 (ruling 2): NOTHING UNSYNCED IS EVER DROPPED — not by age, not by
  // the cap. Only sent items fall off, and only the oldest of those beyond the
  // cap. A record made Tuesday in a coulee is still here Friday in town.
  const fresh = items.filter(i => !(i.state === 'synced' && i.syncedAt && now - i.syncedAt > SYNCED_TTL_MS))
  const unsynced = fresh.filter(i => i.state !== 'synced')
  const synced = fresh.filter(i => i.state === 'synced')
  const room = Math.max(0, MAX_ITEMS - unsynced.length)
  const keptSet = new Set([...unsynced, ...synced.slice(-room)])
  const kept = fresh.filter(i => keptSet.has(i))
  const json = JSON.stringify(kept)
  try {
    localStorage.setItem(KEY, json)
  } catch (e) {
    // Block 21 (ruling 4) and Block 22 (ruling 3): a pending record outranks
    // every piece of work-in-progress, but they are given up ONE AT A TIME
    // and cheapest first — the ride draft, then the live tally. So this keeps
    // asking for room and retrying until the record is written or there is
    // nothing left that a record is allowed to outrank. If it still will not
    // go, the caller says so in storage's own words, never the network's.
    if (!isQuotaError(e)) throw e
    for (;;) {
      if (!makeRoomForRecords()) throw e
      try { localStorage.setItem(KEY, json); break } catch (again) { if (!isQuotaError(again)) throw again }
    }
  }
  cache = kept
  for (const l of listeners) l()
}

// ─── A full phone is not a lost signal (Block 21, ruling 5) ───────────────────
// "Couldn't send" is the NETWORK's word and nothing else's. A phone that will
// not keep its own copy is a different problem with different words and a
// different thing to do about it, so it is tracked apart here and never
// written onto a record as a failure to send.
let storageFull = false

export function storageIsFull(): boolean { return storageFull }

function noteStorage(e: unknown): boolean {
  if (!isQuotaError(e)) return false
  if (!storageFull) { storageFull = true; for (const l of listeners) l() }
  return true
}

function clearedStorage(): void {
  if (storageFull) { storageFull = false; for (const l of listeners) l() }
}

/**
 * update() that never blames the network for the phone. Returns false when the
 * phone refused to keep the change — the record itself is untouched and still
 * on the shelf, so the next wake tries again.
 */
function safeUpdate(id: string, patch: Partial<OutboxItem>): boolean {
  try {
    update(id, patch)
    clearedStorage()
    return true
  } catch (e) {
    if (!noteStorage(e)) throw e
    return false
  }
}

function update(id: string, patch: Partial<OutboxItem>): OutboxItem | null {
  const items = read()
  const i = items.findIndex(x => x.id === id)
  if (i < 0) return null
  const next = { ...items[i], ...patch }
  const copy = items.slice(); copy[i] = next
  try { write(copy) } catch { cache = copy; for (const l of listeners) l() }
  return next
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function newEventId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4${Math.random().toString(16).slice(2, 5)}-a${Math.random().toString(16).slice(2, 5)}-${Math.random().toString(16).slice(2, 14)}`
}

export function getOutbox(): OutboxItem[] { return read() }

/**
 * Work the sync loop will retry. 'failed' is deliberately NOT here: a
 * permanently rejected entry must not keep waking the retry timer.
 */
export function pendingCount(): number {
  return read().filter(i => i.state === 'local' || i.state === 'queued').length
}

/**
 * Work that has NOT reached the ranch — including 'failed'.
 *
 * These two counts were one function until Block 7, and the difference is the
 * whole reason an entry could be lost without a word: a server-rejected entry
 * is not retryable, so it is correctly absent from pendingCount() — but it is
 * absolutely still the operator's unsynced work, and clearPrivateState() will
 * delete it. Anything that asks "is there work here I would destroy?" must ask
 * THIS one.
 */
export function unsyncedCount(): number {
  return read().filter(i => i.state !== 'synced').length
}

export function hasUnsynced(): boolean { return unsyncedCount() > 0 }

/**
 * Save an entry on the phone. Returns the item in state 'local'. THROWS if the
 * phone's storage refused — nothing was saved, and the caller must say so.
 * `holdMs` defers the first upload (undo window).
 */
export function enqueue(body: Record<string, unknown>, label: string, holdMs = 0, opts: { endpoint?: string; link?: { href: string; label: string } } = {}): OutboxItem {
  const id = typeof body.id === 'string' && body.id ? body.id : newEventId()
  const hold = Math.max(holdMs, MIN_DWELL_MS)
  // Block 15 (ruling 2): a FIX re-saves under the same id. The refused item is
  // replaced in place — same id, new body, back to Saved — so the ranch sees
  // one record and a retry after a landed fix is still a duplicate, never two.
  const existing = read().find(i => i.id === id)
  if (existing) {
    const fixed: OutboxItem = { ...existing, body: { ...body, id }, label, state: 'local', attempts: 0, lastError: undefined, holdUntil: Date.now() + hold, undoable: false, consequence: undefined, followUp: undefined, ...(opts.endpoint ? { endpoint: opts.endpoint } : {}), ...(opts.link ? { link: opts.link } : {}) }
    write(read().map(i => (i.id === id ? fixed : i)))
    scheduleFlush(hold)
    return fixed
  }
  const item: OutboxItem = {
    id,
    body: { ...body, id },
    label,
    createdAt: Date.now(),
    state: 'local',
    attempts: 0,
    holdUntil: Date.now() + hold,
    undoable: holdMs > 0,
    owner: ownerNow() ?? undefined,
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
    ...(opts.link ? { link: opts.link } : {}),
  }
  write([...read(), item])            // throws → caller shows "Couldn't save"
  scheduleFlush(hold)
  return item
}

/** Undo: drop an entry that has not left the phone. False if it already has. */
export function cancel(id: string): boolean {
  const item = read().find(i => i.id === id)
  if (!item || item.state !== 'local' || inFlight === id) return false
  try { write(read().filter(i => i.id !== id)) } catch { /* keep */ }
  return true
}

/** Block 5D: drop everything on the phone — sign-out or an account switch. */
export function clearOutbox(): void {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
  cache = []
  for (const l of listeners) l()
}

/** Discard a failed entry (the person chose not to fix it). */
/**
 * Block 11 (P0): a receipt is transient, and an entry that has been corrected,
 * voided or deleted has no receipt at all.
 *
 * The outbox is the record of what this PHONE did, so a synced entry stayed in
 * it forever and the strip kept quoting a balance from before the correction —
 * on the audit, a receipt reading "= 239 bales on hand" sat three inches above
 * a hay card reading 253, and offered "Open this entry" for a row that had been
 * deleted. Two balances on one screen, and the wrong one was the louder.
 *
 * Called by whatever changes an entry's standing. Matches on the server id and
 * on the client-minted id, because the two are the same value for anything
 * this phone recorded and different for anything it did not. Only SYNCED items
 * are forgotten: unsynced work is the offline promise and is never dropped
 * behind a person's back.
 */
export function forgetSynced(eventId: string): void {
  if (!eventId) return
  const before = read()
  const after = before.filter(i => !(i.state === 'synced' && (i.serverId === eventId || i.id === eventId)))
  if (after.length !== before.length) { try { write(after) } catch { /* keep what is there */ } }
}

/** Block 14: the follow-up was taken or declined; it does not show again. */
export function settleFollowUp(id: string): void {
  const item = read().find(i => i.id === id)
  if (item?.followUp) update(id, { followUp: { ...item.followUp, done: true } })
}

export function discard(id: string): void {
  try { write(read().filter(i => i.id !== id)) } catch { /* keep */ }
}

/** Put a failed entry back in the queue and try now. */
export function retry(id: string): void {
  update(id, { state: 'queued', lastError: undefined, holdUntil: undefined })
  void flush()
}

/** The most recent entry, for the status line. */
export function latest(): OutboxItem | null {
  const items = read()
  return items.length ? items[items.length - 1] : null
}

// ─── Upload loop ──────────────────────────────────────────────────────────────

let inFlight: string | null = null
let flushing = false
let timer: ReturnType<typeof setTimeout> | null = null

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504])

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function uploadOne(item: OutboxItem): Promise<void> {
  inFlight = item.id
  const queuedAt = Date.now()
  // Ruling 5: every status write below goes through safeUpdate, so a phone
  // that will not keep its own copy is reported as a full phone and never as
  // a record that could not be sent. The record itself is untouched either
  // way — it stays on the shelf and the next wake tries again.
  if (!safeUpdate(item.id, { state: 'queued', attempts: item.attempts + 1, holdUntil: undefined })) { inFlight = null; return }
  try {
    // Block 7A: the endpoint is the item's, so a place and an entry share one
    // queue, one retry loop and one set of words. Both routes answer a replayed
    // id with 200 and the row that already landed.
    const res = await fetch(item.endpoint ?? '/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.body),
    })
    const json = await res.json().catch(() => ({} as Record<string, unknown>))
    if (res.ok) {
      const consequence = json && typeof json === 'object' && Array.isArray((json as { consequence?: { lines?: unknown } }).consequence?.lines)
        ? { lines: ((json as { consequence: { lines: unknown[] } }).consequence.lines).filter((l): l is string => typeof l === 'string') }
        : undefined
      const j = json as { event?: { id?: string }; place?: { id?: string }; follow_up?: FollowUp }
      const serverId = j.event?.id ?? j.place?.id
      const followUp = j.follow_up && j.follow_up.kind === 'set_head' && typeof j.follow_up.lot_id === 'string' && typeof j.follow_up.head === 'number' ? j.follow_up : undefined
      await sleep(Math.max(0, MIN_DWELL_MS - (Date.now() - queuedAt)))   // 'queued' is seen before 'synced'
      safeUpdate(item.id, { state: 'synced', syncedAt: Date.now(), lastError: undefined, consequence, serverId, ...(followUp ? { followUp } : {}) })
      return
    }
    const message = typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : `Server said ${res.status}`
    if (TRANSIENT.has(res.status)) {
      safeUpdate(item.id, { state: 'queued', lastError: message })
      return
    }
    if (res.status === 401) {
      safeUpdate(item.id, { state: 'queued', lastError: 'Sign in to send it' })
      return
    }
    safeUpdate(item.id, { state: 'failed', lastError: message })
  } catch {
    // No network, DNS, aborted — the phone still has it. A phone that would
    // not keep its own copy never lands here: safeUpdate reports that apart,
    // so this branch only ever means the network (ruling 5).
    safeUpdate(item.id, { state: 'queued', lastError: undefined })
  } finally {
    inFlight = null
  }
}

/** Upload everything pending, oldest first, one at a time. Safe to call often. */
export async function flush(): Promise<void> {
  if (flushing) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { scheduleFlush(RETRY_TIMER_MS); return }
  flushing = true
  try {
    for (;;) {
      const now = Date.now()
      // Block 5D: an entry saved under a different person than the one signed in
      // now is dropped, never uploaded as theirs (the account-switch guard
      // clears the outbox too; this holds if the sync timer wins that race).
      const owner = ownerNow()
      const foreign = read().filter(i => i.owner && owner && i.owner !== owner)
      if (foreign.length) { try { write(read().filter(i => !foreign.includes(i))) } catch { /* keep */ } }
      const next = read().find(i => (i.state === 'local' || i.state === 'queued') && (!i.holdUntil || i.holdUntil <= now))
      if (!next) break
      await uploadOne(next)
      if (storageIsFull()) break   // ruling 5: the phone, not the signal — stop rather than spin
      const after = read().find(i => i.id === next.id)
      if (after && after.state === 'queued') break   // transient failure — back off
    }
  } finally {
    flushing = false
    if (pendingCount() > 0) scheduleFlush(RETRY_TIMER_MS)
  }
}

/** Every refused record goes back in line once (state queued, its reason kept until the ranch answers again). */
function retryRefused(): void {
  const refused = read().filter(i => i.state === 'failed')
  for (const i of refused) update(i.id, { state: 'queued' })
}

function scheduleFlush(delayMs: number): void {
  if (typeof window === 'undefined') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void flush() }, Math.max(0, delayMs))
}

// ─── Wiring: online, foreground, leave-page guard ─────────────────────────────

let wired = false
function wire(): void {
  if (wired || typeof window === 'undefined') return
  wired = true
  // Block 15 (ruling 2): retry is automatic and forever, with no button. A
  // refused record is not retried every twenty seconds — the same body gets
  // the same answer — but every time the app wakes (signal back, brought to
  // the front) each refused record is offered once more, because the rule
  // that refused it may have changed on the ranch. Refused again, it goes
  // back to "Couldn't send" with the fresh reason; nothing is ever dropped.
  const wake = () => { retryRefused(); void flush() }
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake() })
  window.addEventListener('focus', wake)
  window.addEventListener('storage', e => { if (e.key === KEY) { cache = null; for (const l of listeners) l() } })
  // Warn before leaving with anything unsynced. Browsers show their own text.
  window.addEventListener('beforeunload', e => {
    if (hasUnsynced()) { e.preventDefault(); e.returnValue = '' }
  })
  retryRefused()
  if (pendingCount() > 0) scheduleFlush(0)
}

// ─── React binding ────────────────────────────────────────────────────────────

function subscribe(l: () => void): () => void {
  wire()
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const EMPTY: OutboxItem[] = []
function getSnapshot(): OutboxItem[] { return read() }
function getServerSnapshot(): OutboxItem[] { return EMPTY }

/** Live view of the outbox for any client component. */
/** True while the phone is refusing to keep its own copy (ruling 5). */
export function useStorageFull(): boolean {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => storageFull,
    () => false,
  )
}

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
