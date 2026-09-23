import { createClient } from '@/lib/supabase-server'
import { devicesNeedingAttention } from '@/lib/devices-attention'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { fmtDay, fmtTime } from '@/lib/jobs/format'
import HeldRow from '@/app/components/HeldRow'

// ─── Needs attention · Check device (Block 6A) ────────────────────────────────
// One row per device that has a known cadence and missed it, one action each
// (open it under Ranch → Devices). Renders nothing when there is nothing —
// which, with no cadence in the model yet, is every day so far.
export default async function DeviceAttention() {
  const supabase = await createClient()
  const rows = await devicesNeedingAttention(supabase).catch(() => [])
  if (rows.length === 0) return null
  return (
    <Card shadow="soft" className="p-4 sm:p-5" data-audit="needs-attention-devices">
      <p className={EYEBROW}>A device has gone quiet</p>
      <ul className="mt-2 divide-y divide-rule">
        {rows.map(d => (
          <li key={d.id}>
          {/* Block 13: hold for Fix (name, where it sits) · Delete. */}
          <HeldRow label={d.name} openHref={`/ranch/devices#${d.id}`} fixHref={`/ranch/devices#fix-${d.id}`} del={{ kind: 'device', id: d.id }}>
          <div className="flex min-h-[56px] items-center justify-between gap-3 py-2" data-audit="device-attention-row">
            <span className="font-dm-sans text-[17px] text-ink">
              <span className="font-semibold">{d.name}</span> has not reported
              <span className="block text-[15px] text-secondary-ink">{d.lastSeen ? `Last collected ${fmtDay(d.lastSeen)} ${fmtTime(d.lastSeen)}` : 'Never collected'} · expected every {Math.round(d.expectedEveryMs / 3_600_000)} h</span>
            </span>
          </div>
          </HeldRow>
          </li>
        ))}
      </ul>
    </Card>
  )
}
