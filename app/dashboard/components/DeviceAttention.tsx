import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { devicesNeedingAttention } from '@/lib/devices-attention'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { fmtDay, fmtTime } from '@/lib/jobs/format'

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
      <p className={EYEBROW}>Needs attention</p>
      <ul className="mt-2 divide-y divide-rule">
        {rows.map(d => (
          <li key={d.id} className="flex min-h-[56px] items-center justify-between gap-3 py-2">
            <span className="font-dm-sans text-[17px] text-ink">
              <span className="font-semibold">Check device</span> · {d.name}
              <span className="block text-[15px] text-secondary-ink">{d.lastSeen ? `Last collected ${fmtDay(d.lastSeen)} ${fmtTime(d.lastSeen)}` : 'Never collected'} · expected every {Math.round(d.expectedEveryMs / 3_600_000)} h</span>
            </span>
            <Link href={`/ranch/devices#${d.id}`} className="inline-flex min-h-[48px] shrink-0 items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink">Open</Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
