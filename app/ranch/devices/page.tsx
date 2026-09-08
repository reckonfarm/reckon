import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { privateTitle } from '@/lib/private-title'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { fmtDay, fmtTime, dayKey } from '@/lib/jobs/format'
import RecordHere from '../places/RecordHere'

// ─── /ranch/devices (Block 6A) — the Devices section ──────────────────────────
// Empty: says you can record work now, and what will appear here. Populated:
// "{Place or machine} · {role}" leads; the product name is a label; last
// observation and last sync are separate lines; battery when known; the
// hardware id, firmware, signal, and raw voltage sit under Details. Status
// words are "Last collected …" / "Waiting for collection" / "Check device" —
// never "Online" for a sleeping logger, never "Offline" as a blanket verdict.
// "Check device" needs a known cadence (lib/devices-attention); none is known.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Devices')

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

// Role and product are display labels derived from the raw type — no column.
function roleOf(type: string): { role: string; product: string } {
  const t = type.toLowerCase()
  if (/scout|machine|baler|tractor|swather|rake/.test(t)) return { role: 'machine activity', product: 'Scout' }
  if (/spotter|rain|gauge/.test(t)) return { role: 'rain gauge', product: 'Spotter' }
  if (/sentinel|tank|water|fixed/.test(t)) return { role: t.includes('tank') ? 'tank level' : 'fixed-location logger', product: 'Sentinel' }
  return { role: t.replace(/_/g, ' '), product: 'Device' }
}

// Collection status from last_seen alone (the honest thing the model holds).
function statusOf(lastSeen: string | null): { word: string; detail: string } {
  if (!lastSeen) return { word: 'Waiting for collection', detail: 'No readings have reached the ranch yet.' }
  const day = dayKey(lastSeen), today = dayKey(Date.now()), yesterday = dayKey(Date.now() - 86_400_000)
  if (day === today) return { word: 'Last collected today', detail: fmtTime(lastSeen) }
  if (day === yesterday) return { word: 'Last collected yesterday', detail: fmtTime(lastSeen) }
  return { word: 'Waiting for collection', detail: `Last collected ${fmtDay(lastSeen)}` }
}

export default async function DevicesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch/devices')
  const { data, error } = await supabase
    .from('devices')
    .select('id, hardware_id, type, name, battery_pct, last_seen, fw_version, places(name)')
    .order('name', { ascending: true })
  const devices = (data ?? []) as unknown as DeviceRow[]
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch · Devices</p>
        <h1 className="mt-1 type-page-heading text-ink">Devices</h1>

        {error && (
          <Card className="mt-4 p-5"><p className="font-dm-sans text-[17px] text-ink">Devices could not be read just now. Try again in a moment.</p></Card>
        )}

        {!error && devices.length === 0 && (
          <Card className="mt-4 p-5" data-audit="devices-empty">
            <p className="font-dm-sans text-[17px] leading-relaxed text-ink">No devices connected. You can record work now. Connected devices will appear here with their latest observations and check-in status.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <RecordHere />
              <Link href="/ranch/devices/setup" className="inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink" data-audit="setup-device">Set up a device</Link>
            </div>
          </Card>
        )}

        {devices.length > 0 && (
          <ul className="mt-4 space-y-3" data-audit="device-cards">
            {devices.map(d => {
              const { role, product } = roleOf(d.type)
              const status = statusOf(d.last_seen)
              const lead = d.places?.name ?? d.name
              return (
                <li key={d.id} id={d.id}>
                  <Card className="p-4 sm:p-5" data-audit="device-card">
                    <p className="font-dm-sans text-[17px] font-semibold text-ink">{lead} <span className="font-normal text-secondary-ink">· {role}</span></p>
                    <p className="mt-0.5 font-dm-sans text-[15px] text-secondary-ink">{product}{d.name !== lead ? ` · ${d.name}` : ''}</p>
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-dm-sans text-[16px]">
                      <dt className="text-secondary-ink">Last observation</dt><dd className="text-ink">{d.last_seen ? `${fmtDay(d.last_seen)} · ${fmtTime(d.last_seen)}` : 'None yet'}</dd>
                      <dt className="text-secondary-ink">Last sync</dt><dd className="text-ink" data-audit="device-status">{status.word}{status.detail ? ` · ${status.detail}` : ''}</dd>
                      {d.battery_pct != null && (<><dt className="text-secondary-ink">Battery</dt><dd className="text-ink tabular-nums">{d.battery_pct}%</dd></>)}
                    </dl>
                    <details className="mt-3">
                      <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">Details</summary>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-dm-sans text-[15px] text-secondary-ink">
                        <dt>Hardware ID</dt><dd className="text-ink">{d.hardware_id}</dd>
                        <dt>Firmware</dt><dd className="text-ink">{d.fw_version ?? 'Not reported'}</dd>
                        <dt>Signal</dt><dd className="text-ink">Not reported</dd>
                        <dt>Raw voltage</dt><dd className="text-ink">Not reported</dd>
                      </dl>
                    </details>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
        {devices.length > 0 && (
          <p className="mt-4"><Link href="/ranch/devices/setup" className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">Set up another device</Link></p>
        )}
      </main>
    </>
  )
}
