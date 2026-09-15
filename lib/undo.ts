'use client'

import { useSyncExternalStore } from 'react'

// ─── Deleted · Undo (Block 13) ────────────────────────────────────────────────
//
// DELETE MEANS ONE THING. A row goes to the trash the moment Delete is tapped —
// no confirm sheet, no "are you sure" — and for ten seconds a strip at the
// bottom of the screen says "Deleted · <what>" with one button: Undo. Undo puts
// it back exactly where it was. That strip IS the safety, and it is the same
// strip for an entry, a place, a bunch, a device, a machine session, a county
// on the watchlist, a person, an invitation.
//
// One item at a time: a second delete replaces the first on the strip (the
// first is still in the trash; /account/trash has it for seven days). Memory
// only, never localStorage — an undo that outlives the ten seconds is not an
// undo, it is the trash page.
//
// This module is the only writer. React reads it through useUndo().

export const UNDO_MS = 10_000

export interface UndoItem {
  id: string
  /** "Fed 4 bales" · "North stackyard" · "Cull cows" — the row, in its own words. */
  label: string
  /** Puts it back. Resolves true when it did; false with a sentence when it could not. */
  undo: () => Promise<{ ok: true } | { ok: false; error: string }>
  /** Where to take the person after Undo, if the row's own page is the right place. */
  after?: string | null
  expiresAt: number
  state: 'shown' | 'undoing' | 'undone' | 'failed'
  error?: string
}

let current: UndoItem | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

function emit() { for (const l of listeners) l() }

/** Show the strip for one deleted thing. */
export function offerUndo(label: string, undo: UndoItem['undo'], after?: string | null): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  current = { id, label, undo, after: after ?? null, expiresAt: Date.now() + UNDO_MS, state: 'shown' }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { if (current?.id === id) { current = null; emit() } }, UNDO_MS)
  emit()
  return id
}

/** Tap Undo. */
export async function runUndo(): Promise<boolean> {
  const item = current
  if (!item || item.state !== 'shown') return false
  current = { ...item, state: 'undoing' }; emit()
  let r: Awaited<ReturnType<UndoItem['undo']>>
  try { r = await item.undo() } catch { r = { ok: false, error: 'No signal — it is still in the trash.' } }
  if (current?.id !== item.id) return r.ok
  if (r.ok) {
    current = { ...item, state: 'undone' }; emit()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { if (current?.id === item.id) { current = null; emit() } }, 2_500)
    return true
  }
  current = { ...item, state: 'failed', error: r.error }; emit()
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { if (current?.id === item.id) { current = null; emit() } }, 6_000)
  return false
}

/** A sentence on the strip with no Undo — a delete that was refused, say. */
export function showNotice(error: string): void {
  const id = `${Date.now().toString(36)}-n`
  current = { id, label: '', undo: async () => ({ ok: true }), after: null, expiresAt: Date.now() + 6_000, state: 'failed', error }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { if (current?.id === id) { current = null; emit() } }, 6_000)
  emit()
}

export function dismissUndo(): void { current = null; if (timer) clearTimeout(timer); timer = null; emit() }

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
export function useUndo(): UndoItem | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}

// ─── The one delete call every row makes ──────────────────────────────────────
// Runs the delete, and on success offers Undo. The row's own component decides
// what "delete" and "put back" are for its kind of thing; this only holds the
// shape so every row reads the same.
export async function deleteWithUndo(args: {
  label: string
  run: () => Promise<{ ok: true } | { ok: false; error: string }>
  undo: UndoItem['undo']
  after?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let r: Awaited<ReturnType<typeof args.run>>
  try { r = await args.run() } catch { r = { ok: false, error: 'No signal — nothing was deleted.' } }
  if (r.ok) offerUndo(args.label, args.undo, args.after)
  return r
}

/** fetch → { ok } | { ok:false, error } with the server's own sentence when it has one. */
export async function callDelete(input: string, init?: RequestInit): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(input, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  if (res.ok) return { ok: true }
  const j = await res.json().catch(() => ({})) as { error?: string; message?: string }
  return { ok: false, error: j.message ?? j.error ?? `That could not be done just now (${res.status}).` }
}

/** POST /api/trash { table, id } — the one restore call for anything with deleted_at. */
export function restoreFromTrash(table: string, id: string): () => Promise<{ ok: true } | { ok: false; error: string }> {
  return () => callDelete('/api/trash', { method: 'POST', body: JSON.stringify({ table, id }) })
}
