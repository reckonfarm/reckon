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
}

export const STATE_LABEL: Record<OutboxState, string> = {
  local:  'Saved on this phone',
  queued: 'Waiting to sync',
  synced: 'Synced to ranch',
  failed: "Couldn't save — try again",
}

const KEY = 'dryline_outbox_v1'
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
  const kept = items
    .filter(i => !(i.state === 'synced' && i.syncedAt && now - i.syncedAt > SYNCED_TTL_MS))
    .slice(-MAX_ITEMS)
  localStorage.setItem(KEY, JSON.stringify(kept))
  cache = kept
  for (const l of listeners) l()
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

export function pendingCount(): number {
  return read().filter(i => i.state === 'local' || i.state === 'queued').length
}

export function hasUnsynced(): boolean { return pendingCount() > 0 }

/**
 * Save an entry on the phone. Returns the item in state 'local'. THROWS if the
 * phone's storage refused — nothing was saved, and the caller must say so.
 * `holdMs` defers the first upload (undo window).
 */
export function enqueue(body: Record<string, unknown>, label: string, holdMs = 0): OutboxItem {
  const id = typeof body.id === 'string' && body.id ? body.id : newEventId()
  const hold = Math.max(holdMs, MIN_DWELL_MS)
  const item: OutboxItem = {
    id,
    body: { ...body, id },
    label,
    createdAt: Date.now(),
    state: 'local',
    attempts: 0,
    holdUntil: Date.now() + hold,
    undoable: holdMs > 0,
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

/** Discard a failed entry (the person chose not to fix it). */
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
  update(item.id, { state: 'queued', attempts: item.attempts + 1, holdUntil: undefined })
  try {
    const res = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.body),
    })
    const json = await res.json().catch(() => ({} as Record<string, unknown>))
    if (res.ok) {
      const consequence = json && typeof json === 'object' && Array.isArray((json as { consequence?: { lines?: unknown } }).consequence?.lines)
        ? { lines: ((json as { consequence: { lines: unknown[] } }).consequence.lines).filter((l): l is string => typeof l === 'string') }
        : undefined
      const serverId = (json as { event?: { id?: string } }).event?.id
      await sleep(Math.max(0, MIN_DWELL_MS - (Date.now() - queuedAt)))   // 'queued' is seen before 'synced'
      update(item.id, { state: 'synced', syncedAt: Date.now(), lastError: undefined, consequence, serverId })
      return
    }
    const message = typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : `Server said ${res.status}`
    if (TRANSIENT.has(res.status)) {
      update(item.id, { state: 'queued', lastError: message })
      return
    }
    if (res.status === 401) {
      update(item.id, { state: 'queued', lastError: 'Signed out — sign in to sync' })
      return
    }
    update(item.id, { state: 'failed', lastError: message })
  } catch (err) {
    // No network, DNS, aborted — the phone still has it.
    update(item.id, { state: 'queued', lastError: err instanceof Error && err.message ? 'No connection' : 'No connection' })
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
      const next = read().find(i => (i.state === 'local' || i.state === 'queued') && (!i.holdUntil || i.holdUntil <= now))
      if (!next) break
      await uploadOne(next)
      const after = read().find(i => i.id === next.id)
      if (after && after.state === 'queued') break   // transient failure — back off
    }
  } finally {
    flushing = false
    if (pendingCount() > 0) scheduleFlush(RETRY_TIMER_MS)
  }
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
  window.addEventListener('online', () => void flush())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void flush() })
  window.addEventListener('focus', () => void flush())
  window.addEventListener('storage', e => { if (e.key === KEY) { cache = null; for (const l of listeners) l() } })
  // Warn before leaving with anything unsynced. Browsers show their own text.
  window.addEventListener('beforeunload', e => {
    if (hasUnsynced()) { e.preventDefault(); e.returnValue = '' }
  })
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
export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
