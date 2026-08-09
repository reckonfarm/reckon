'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'

// Ground truth entry — what actually came off this field, in the operator's
// words. Reported once from the cab; the detected-vs-actual comparison then
// builds itself from real field days. Blank means "not reported": a swather
// day has no bale count, and clearing a field never writes a zero.
//
// The detector and the boundary math NEVER read these (039 header) — actuals
// are the exam key, not the training set. Comparison is display-only.

async function patch(jobId: string, body: Record<string, unknown>) {
  await fetch(`/api/jobs/${jobId}/annotation`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export default function ActualsCard({ jobId, actualBaleCount, actualAcres }: {
  jobId: string
  actualBaleCount: number | null
  actualAcres: number | null
}) {
  const router = useRouter()
  const hasAny = actualBaleCount != null || actualAcres != null
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(!hasAny)
  const [bales, setBales] = useState(actualBaleCount != null ? String(actualBaleCount) : '')
  const [acres, setAcres] = useState(actualAcres != null ? String(actualAcres) : '')

  const save = async () => {
    // Empty input = "not reported" = null. Bad numbers never leave the form.
    const baleNum = bales.trim() === '' ? null : Number(bales)
    const acreNum = acres.trim() === '' ? null : Number(acres)
    if (baleNum !== null && (!Number.isInteger(baleNum) || baleNum < 0 || baleNum > 10000)) return
    if (acreNum !== null && (!Number.isFinite(acreNum) || acreNum < 0 || acreNum > 10000)) return
    setBusy(true)
    try {
      await patch(jobId, { actual_bale_count: baleNum, actual_acres: acreNum })
      setEditing(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card shadow="none" className="mt-5 px-5 py-4">
      <p className="font-fraunces text-base font-semibold text-forest-green">Field actuals</p>

      {!editing ? (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <p className="font-dm-sans text-sm text-forest-green/70">
            You reported{' '}
            {actualBaleCount != null && (
              <span className="font-semibold tabular-nums text-forest-green">
                {actualBaleCount.toLocaleString()} bale{actualBaleCount === 1 ? '' : 's'}
              </span>
            )}
            {actualBaleCount != null && actualAcres != null && ' · '}
            {actualAcres != null && (
              <span className="font-semibold tabular-nums text-forest-green">{actualAcres} acres</span>
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="font-dm-sans text-xs font-semibold text-forest-green/60 hover:text-forest-green disabled:opacity-50"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="mt-1">
          <p className="font-dm-sans text-sm text-forest-green/70">
            What actually came off this field? Leave blank what doesn&apos;t apply.
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={e => { e.preventDefault(); save() }}
          >
            <label className="font-dm-sans text-xs text-forest-green/60">
              Bales
              <input
                value={bales}
                onChange={e => setBales(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="—"
                className="mt-1 block w-24 rounded-lg border border-forest-green/20 bg-white px-3 py-2 font-dm-sans text-base tabular-nums text-forest-green outline-none focus:border-forest-green/40"
              />
            </label>
            <label className="font-dm-sans text-xs text-forest-green/60">
              Acres
              <input
                value={acres}
                onChange={e => setAcres(e.target.value)}
                inputMode="decimal"
                placeholder="—"
                className="mt-1 block w-24 rounded-lg border border-forest-green/20 bg-white px-3 py-2 font-dm-sans text-base tabular-nums text-forest-green outline-none focus:border-forest-green/40"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-forest-green px-4 py-2 font-dm-sans text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            {hasAny && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBales(actualBaleCount != null ? String(actualBaleCount) : '')
                  setAcres(actualAcres != null ? String(actualAcres) : '')
                  setEditing(false)
                }}
                className="px-1 py-2 font-dm-sans text-xs font-semibold text-forest-green/50 hover:text-forest-green disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </form>
        </div>
      )}
    </Card>
  )
}
