'use server'

import type { ReactNode } from 'react'
import { renderDeferredView, type DeferredViewKey } from './ViewBodies'
import type { ViewParams } from './DashboardViews'

// ─── Deferred view loader — a server action the panels call ONCE per body ─────
// The dashboard's peer views are server components (RLS-scoped reads, Suspense
// streaming, the lazy client islands inside them), so "don't mount until first
// activated" means "don't render on the server until asked": the client panel
// calls this on the first tap, gets the body's RSC back, and keeps it mounted
// from then on. next/dynamic can't do this — it splits client JavaScript, not
// server rendering.
//
// Inputs are validated the way a route handler would: a key from the fixed
// set, a 5-digit fips, date-shaped gs/ge, a short pt. Auth is the cookie
// session (middleware refreshed it on the way in); the bodies keep their own
// signed-out gates, so a signed-out call for Jobs returns the private-ledger
// card, exactly what the page renders.

const KEYS: ReadonlySet<string> = new Set(['jobs', 'drought', 'hay', 'markets'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function loadDashboardView(key: string, params: ViewParams): Promise<ReactNode> {
  if (!KEYS.has(key)) return null
  if (typeof params?.fips !== 'string' || !/^\d{5}$/.test(params.fips)) return null
  const clean: ViewParams = {
    fips: params.fips,
    gs: typeof params.gs === 'string' && DATE_RE.test(params.gs) ? params.gs : undefined,
    ge: typeof params.ge === 'string' && DATE_RE.test(params.ge) ? params.ge : undefined,
    pt: typeof params.pt === 'string' && params.pt.length <= 60 ? params.pt : undefined,
  }
  return renderDeferredView(key as DeferredViewKey, clean)
}
