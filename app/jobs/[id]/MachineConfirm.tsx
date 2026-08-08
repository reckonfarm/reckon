'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MACHINE_SUGGESTIONS } from '@/lib/jobs/annotations'

// System proposes, user confirms — the machine label is captured off the back
// of a detection ("32 gate slams — was this baling?"), never demanded up
// front. One tap sets job_annotations.machine (and a default name when the
// session is unnamed); detection itself never waited on it.

async function patch(jobId: string, body: Record<string, unknown>) {
  await fetch(`/api/jobs/${jobId}/annotation`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export default function MachineConfirm({ jobId, name, machine, proposedCount }: {
  jobId: string
  name: string | null
  machine: string | null
  proposedCount: number | null // detected slam count, when there is a proposal
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [othersOpen, setOthersOpen] = useState(false)

  const run = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      await patch(jobId, body)
      setOthersOpen(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const chipCls =
    'rounded-full border border-forest-green/20 px-3 py-1.5 font-dm-sans text-sm text-forest-green hover:bg-forest-green/5 disabled:opacity-50'

  // Already labeled: a quiet change affordance, not a question.
  if (machine != null) {
    const label = MACHINE_SUGGESTIONS.find(m => m.value === machine)?.label ?? machine
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="font-dm-sans text-xs text-forest-green/50">
          Machine: <span className="font-semibold text-forest-green/80">{label}</span>
        </p>
        {!othersOpen ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setOthersOpen(true)}
            className="font-dm-sans text-xs font-semibold text-forest-green/60 hover:text-forest-green disabled:opacity-50"
          >
            Change
          </button>
        ) : (
          <span className="flex flex-wrap gap-2">
            {MACHINE_SUGGESTIONS.map(m => (
              <button key={m.value} type="button" disabled={busy} onClick={() => run({ machine: m.value })} className={chipCls}>
                {m.label}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => run({ machine: null })} className={chipCls}>
              Clear
            </button>
          </span>
        )}
      </div>
    )
  }

  // The proposal: one tap confirms and labels.
  return (
    <div className="mt-3">
      <p className="font-dm-sans text-sm text-forest-green/70">
        {proposedCount != null
          ? `Was this baling?`
          : `What machine was this?`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run({ machine: 'baler', ...(name == null ? { name: 'Baling' } : {}) })}
          className="rounded-full bg-forest-green px-4 py-1.5 font-dm-sans text-sm font-semibold text-white disabled:opacity-50"
        >
          Yes, baling
        </button>
        {!othersOpen ? (
          <button type="button" disabled={busy} onClick={() => setOthersOpen(true)} className={chipCls}>
            Something else…
          </button>
        ) : (
          MACHINE_SUGGESTIONS.filter(m => m.value !== 'baler').map(m => (
            <button key={m.value} type="button" disabled={busy} onClick={() => run({ machine: m.value })} className={chipCls}>
              {m.label}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
