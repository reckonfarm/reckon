import { Card } from '@/app/components/ui/Card'
import Disclosure from '@/app/components/ui/Disclosure'
import type { ActiveAlert } from '@/lib/nws'

// ─── Active warning — first on Weather, when one is in force (Block 7, Part 2) ─
// Nothing renders when there is none; a failed fetch renders nothing too (the
// page never says "no warnings" on a guess). The closed row is the warning
// itself — event, severity, until when — and the full alert text expands.
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' }) : null

export default async function ActiveWarningCard({ dataPromise }: { dataPromise: Promise<ActiveAlert[] | null> }) {
  const alerts = await dataPromise
  if (!alerts || alerts.length === 0) return null
  return (
    <section aria-labelledby="wx-warning-h" data-audit="weather-warning">
      <h2 id="wx-warning-h" className="font-dm-sans text-[14px] font-semibold uppercase tracking-wide text-rust">Active {alerts.length === 1 ? 'warning' : 'warnings'} · NWS</h2>
      <div className="mt-2 space-y-2">
        {alerts.map(a => (
          <Card key={a.id} shadow="none" className="border-l-4 border-rust px-5 py-3" data-audit="weather-warning-item">
            <p className="font-fraunces text-lg font-semibold leading-tight text-ink">{a.event}</p>
            <p className="mt-0.5 font-dm-sans text-[16px] text-ink">{[a.severity, a.expires ? `until ${fmt(a.expires)}` : null, a.senderName].filter(Boolean).join(' · ')}</p>
            {a.headline && <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">{a.headline}</p>}
            <Disclosure title="Full alert" audit={`warning-${a.id.slice(-8)}`} className="mt-2" summary="What it says and what to do">
              {a.description && <p className="whitespace-pre-line font-dm-sans text-[16px] leading-relaxed text-ink">{a.description}</p>}
              {a.instruction && <p className="mt-2 whitespace-pre-line font-dm-sans text-[16px] font-medium leading-relaxed text-ink">{a.instruction}</p>}
            </Disclosure>
          </Card>
        ))}
      </div>
    </section>
  )
}
