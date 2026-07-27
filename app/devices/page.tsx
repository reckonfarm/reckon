import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Heading } from '@/app/components/ui/Heading'
import { Card } from '@/app/components/ui/Card'

// ─── /devices — the registry, v0 (S2, the receiving dock) ──────────────────────
// Bare list: every device the ranch owns — name, type, battery, last-seen,
// assigned place. Auth-gated like /herd. Reads via the USER-SCOPED SSR client
// on purpose: this page is the first consumer of the devices/places RLS
// policies (031), so it exercises them instead of bypassing them — a producer
// sees ONLY their own hardware. No pairing UI here (that's the courier,
// September); v0 registration is a hand INSERT in the SQL editor.

export const dynamic = 'force-dynamic'

interface DeviceRow {
  id: string
  hardware_id: string
  type: string
  name: string
  battery_pct: number | null
  last_seen: string | null
  fw_version: string | null
  places: { name: string } | null
}

// 'tank_node' → 'Tank node' — display only, the raw type stays the identity.
function typeLabel(t: string): string {
  const s = t.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Server-side relative time for last_seen. Coarse buckets are enough for a
// registry glance; the honest word for null is "Never", not a fake dash.
function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'Never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'Just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const d = Math.floor(hr / 24)
  return d === 1 ? 'Yesterday' : `${d} days ago`
}

export default async function DevicesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/devices')

  // RLS scopes this to the signed-in user; `places(name)` embeds through the
  // place_id FK (also owner-scoped by places' own policies).
  const { data, error } = await supabase
    .from('devices')
    .select('id, hardware_id, type, name, battery_pct, last_seen, fw_version, places(name)')
    .order('name', { ascending: true })

  const devices = (data ?? []) as unknown as DeviceRow[]

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Heading level={1} className="!text-2xl sm:!text-3xl">Devices</Heading>
        <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
          Every sensor on the place, and when it last checked in.
        </p>

        <div className="mt-6 space-y-3">
          {error && (
            <Card shadow="none" className="px-5 py-6 text-center">
              <p className="font-dm-sans text-sm text-forest-green/55">
                Devices are temporarily unavailable.
              </p>
            </Card>
          )}

          {!error && devices.length === 0 && (
            <Card shadow="none" className="px-5 py-8 text-center">
              <p className="font-dm-sans text-sm text-forest-green/55">
                No devices yet. Dryline hardware reports here.
              </p>
            </Card>
          )}

          {devices.map(d => (
            <Card key={d.id} shadow="none" className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-fraunces text-base font-semibold text-forest-green sm:text-lg">
                    {d.name}
                  </p>
                  <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
                    {typeLabel(d.type)}
                    <span className="text-forest-green/25"> · </span>
                    {d.places?.name ?? 'Unassigned'}
                    {d.fw_version && (
                      <>
                        <span className="text-forest-green/25"> · </span>
                        fw {d.fw_version}
                      </>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-dm-sans text-sm font-semibold tabular-nums text-forest-green">
                    {d.battery_pct != null ? `${d.battery_pct}%` : '—'}
                  </p>
                  <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
                    {lastSeenLabel(d.last_seen)}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}
