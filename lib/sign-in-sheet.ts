'use client'

import { useSyncExternalStore } from 'react'

// ─── The sign-in sheet's store (Block 49, ruling R1) ─────────────────────────
// Public data is public; ranch data is private; the ask for a sign-in comes
// ONLY when a person tries to write or save something — Record, Save, Watch,
// Count, Fix, Delete. Every write control calls requireSignIn() first: signed
// in it is a no-op and the write goes on; signed out it opens the one sheet
// (SignInSheet, in the root layout) and returns true so the caller stops.
// `returnTo` is where the person lands after signing in — the page they were
// on, with the action they tapped when the URL can carry it (?record=…).
//
// Whether the phone is signed in is known the moment the browser client has
// read its session (SignInSheet writes it); until then it is 'unknown' and a
// write is NOT refused — a signed-in person's first tap is never bounced.

export type Session = 'unknown' | 'in' | 'out'
export interface SignInAsk { returnTo: string; mode: 'signin' | 'signup' }

let session: Session = 'unknown'
let ask: SignInAsk | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }

/** SignInSheet reports what the browser client knows. */
export function setSession(s: Session): void { if (session !== s) { session = s; emit() } }
export function signedOutNow(): boolean { return session === 'out' }

/** Where to land after sign-in: this page, as the address bar has it. */
export function here(): string {
  try { return `${window.location.pathname}${window.location.search}${window.location.hash}` } catch { return '/today' }
}

export function openSignInSheet(opts: { returnTo?: string; mode?: 'signin' | 'signup' } = {}): void {
  ask = { returnTo: opts.returnTo ?? here(), mode: opts.mode ?? 'signin' }
  emit()
}
export function closeSignInSheet(): void { if (ask) { ask = null; emit() } }

/**
 * Call at the top of every write. True = signed out, the sheet is open, stop
 * here (nothing was written). False = go on.
 */
export function requireSignIn(returnTo?: string): boolean {
  if (!signedOutNow()) return false
  openSignInSheet({ returnTo })
  return true
}

/** Thrown by enqueue() signed out, after opening the sheet; callers let it pass quietly. */
export class SignInRequired extends Error { constructor() { super('sign in to save'); this.name = 'SignInRequired' } }
export const isSignInRequired = (e: unknown): boolean => e instanceof SignInRequired || (e instanceof Error && e.name === 'SignInRequired')

export function useSession(): Session { return useSyncExternalStore(subscribe, () => session, () => 'unknown') }
export function useSignInAsk(): SignInAsk | null { return useSyncExternalStore(subscribe, () => ask, () => null) }
