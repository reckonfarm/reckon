import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'

// ─── Activity — the merged ledger feed, v0 (S3) ────────────────────────────────
// PARKED 2026-08-09 (jobs-forward): no longer rendered — the Jobs view
// (JobsView.tsx) replaced the Activity segment; a flat list of raw events is a
// debug view, and derived work sessions are the product. Kept per the
// MarketsNews precedent: component intact, zero render sites, so the renderer
// registry below survives for whenever a ledger feed earns a surface again.
// ONE feed over the events table (S1): hardware readings, decisions, alerts —
// newest first. Self-contained async server component: resolves the user via
// the USER-SCOPED SSR client and reads through RLS (second consumer of 031's
// owner policies after /devices — the query carries no .eq(user_id); the
// policy IS the scope).
//
// RENDERING — registry + honest generic fallback (the map-layer registry
// pattern applied to prose): a curated renderer is ONE entry in RENDERERS;
// every type without one renders through fallbackRender — prettified type
// name + a compact scalar summary of the payload — so a brand-new device
// type reads honestly in the feed the day it ships, no app release. Curated
// renderers fall back themselves when a payload shape surprises them.
//
// FOUR STATES, all distinct: signed-out gate (the dashboard is public, the
// ledger is private) ≠ loading skeleton (Suspense fallback below) ≠ error
// ("unavailable", never fake-empty) ≠ true empty. Cap = 50 newest, STATED on
// screen when hit — never a silent truncation; pagination waits for a real
// user to hit the floor.

const FEED_CAP = 50

interface FeedEvent {
  id: string
  type: string
  ts: string
  payload: Record<string, unknown>
  schema_version: number
  devices: { name: string; places: { name: string } | null } | null
}

interface Rendered {
  title: string
  detail: string | null
  // Optional source-line override for events whose origin isn't a device OR a
  // human hand (e.g. alerts Dryline itself wrote into the ledger).
  source?: string
}

// 'tank_level' → 'Tank level'
function prettifyType(t: string): string {
  const s = t.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Event'
}

// The honest generic fallback — how an UNKNOWN type renders with zero code:
// prettified type as the title, shallow scalar payload fields as the detail.
// Internal bookkeeping keys are skipped; nested objects/arrays are not
// flattened (the raw payload stays queryable in the DB — the feed is a glance,
// not an inspector).
const INTERNAL_KEYS = new Set(['ts_source'])

function fallbackRender(e: FeedEvent): Rendered {
  const parts = Object.entries(e.payload)
    .filter(([k, v]) =>
      !INTERNAL_KEYS.has(k) &&
      (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
  return { title: prettifyType(e.type), detail: parts.length ? parts.join(' · ') : null }
}

// Curated renderers — one entry per type that has EARNED better prose. Each
// falls back honestly when the payload shape surprises it. schema_version is
// on the event for renderers that need to branch on shape later.
type EventRenderer = (e: FeedEvent) => Rendered

const RENDERERS: Record<string, EventRenderer> = {
  tank_level: e => {
    const lvl = e.payload.level_pct
    if (typeof lvl === 'number' && Number.isFinite(lvl)) {
      return { title: `Water at ${Math.round(lvl)}%`, detail: null }
    }
    return fallbackRender(e)
  },
  // Alerts Dryline wrote into the ledger (lib/alert-service, S3 2/2).
  alert: e => {
    const p = e.payload
    if (p.kind === 'lfp_drought_alert' && typeof p.county_name === 'string' && typeof p.tier === 'number') {
      const payments = typeof p.payments === 'number' ? p.payments : null
      return {
        title: `LFP alert — ${p.county_name} County at Tier ${p.tier}`,
        detail: payments != null
          ? `${payments} payment${payments === 1 ? '' : 's'} · USDM week of ${p.week_date}`
          : null,
        source: 'Dryline alert',
      }
    }
    return { ...fallbackRender(e), source: 'Dryline alert' }
  },
}

function renderEvent(e: FeedEvent): Rendered {
  const renderer = RENDERERS[e.type]
  return renderer ? renderer(e) : fallbackRender(e)
}

// Who/where line: the emitting device (+ its place) for hardware events;
// device_id null = a human entry. A deleted device (SET NULL) reads honestly
// as hand-logged history rather than crashing or faking a name.
function sourceLine(e: FeedEvent): string {
  if (!e.devices) return 'Logged by hand'
  return e.devices.places?.name ? `${e.devices.name} · ${e.devices.places.name}` : e.devices.name
}

// Coarse relative time from event ts (ranch time, not server receipt).
function whenLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'Just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const d = Math.floor(hr / 24)
  return d === 1 ? 'Yesterday' : `${d} days ago`
}

// Suspense fallback — the LOADING state, visually distinct from empty/error.
// animate-pulse is disabled in this project's @theme → scoped keyframe.
export function ActivityFeedSkeleton() {
  return (
    <Card shadow="none" className="px-5 py-2">
      <style>{`@keyframes dlFeedPulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
      {[0, 1, 2].map(i => (
        <div key={i} className="py-3" style={{ animation: 'dlFeedPulse 1.6s ease-in-out infinite' }}>
          <div className="h-4 w-2/5 rounded bg-forest-green/10" />
          <div className="mt-2 h-3 w-3/5 rounded bg-forest-green/10" />
        </div>
      ))}
    </Card>
  )
}

export default async function ActivityFeed() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Signed out — the ledger is private; say so plainly (never a fake empty).
  if (!user) {
    return (
      <Card shadow="none" className="px-5 py-8 text-center">
        <p className="font-dm-sans text-sm text-forest-green/70">
          The ranch ledger is private.
        </p>
        <Link
          href="/signin"
          className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-forest-green px-5 font-dm-sans text-sm font-medium text-cream transition-colors hover:bg-forest-green/90"
        >
          Sign in to see your activity
        </Link>
      </Card>
    )
  }

  const { data, error } = await supabase
    .from('events')
    .select('id, type, ts, payload, schema_version, devices(name, places(name))')
    .order('ts', { ascending: false })
    .limit(FEED_CAP)

  // Error ≠ empty: a failed read never masquerades as a clean ledger.
  if (error) {
    return (
      <Card shadow="none" className="px-5 py-8 text-center">
        <p className="font-dm-sans text-sm text-forest-green/55">
          Activity is temporarily unavailable.
        </p>
      </Card>
    )
  }

  const events = (data ?? []) as unknown as FeedEvent[]

  if (events.length === 0) {
    return (
      <Card shadow="none" className="px-5 py-8 text-center">
        <p className="font-dm-sans text-sm text-forest-green/55">
          Nothing in the ledger yet. Decisions and device readings land here.
        </p>
      </Card>
    )
  }

  return (
    <div>
      <Card shadow="none" className="divide-y divide-forest-green/10 px-5 py-1">
        {events.map(e => {
          const r = renderEvent(e)
          return (
            <div key={e.id} className="flex items-baseline justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-fraunces text-base font-semibold text-forest-green">
                  {r.title}
                </p>
                {r.detail && (
                  <p className="mt-0.5 truncate font-dm-sans text-xs text-forest-green/55">
                    {r.detail}
                  </p>
                )}
                <p className="mt-0.5 font-dm-sans text-xs text-forest-green/45">
                  {r.source ?? sourceLine(e)}
                </p>
              </div>
              <p className="shrink-0 font-dm-sans text-xs text-forest-green/50">
                {whenLabel(e.ts)}
              </p>
            </div>
          )
        })}
      </Card>

      {/* The cap, stated — never a silent truncation. */}
      {events.length === FEED_CAP && (
        <p className="mt-2 text-center font-dm-sans text-xs text-forest-green/40">
          Showing the last {FEED_CAP} — older entries are kept, not shown yet.
        </p>
      )}
    </div>
  )
}
