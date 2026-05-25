'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LfpEligibilityResult, LfpTierStatus } from '@/lib/lfp-eligibility'
import {
  estimatePayment,
  formatPaymentLine,
  PAYMENT_RATES_2025,
  type LivestockKind,
} from '@/lib/lfp-payment'
import { getGrazingPreset } from '@/lib/grazing-presets'
import { FARMER_TYPE_KEY } from '@/app/components/FarmerToggle'

// ─── Types ────────────────────────────────────────────────────────────────────

type FarmerMode = 'livestock' | 'rowcrop'

export interface ProgramStatusProps {
  eligibility: LfpEligibilityResult | null
  fips: string
  countyName: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Color band: maps max LFP tier → USDM drought color
const TIER_STYLE: Record<number, { bg: string; fg: string }> = {
  0: { bg: '#F3F4F6', fg: '#6B7280' },  // none
  1: { bg: '#FFAA00', fg: '#451A00' },  // D2 orange
  2: { bg: '#FFAA00', fg: '#451A00' },  // D2 orange
  3: { bg: '#E60000', fg: '#FFFFFF' },  // D3 red
  4: { bg: '#E60000', fg: '#FFFFFF' },  // D3 red
  5: { bg: '#730000', fg: '#FFFFFF' },  // D4 dark red
  6: { bg: '#730000', fg: '#FFFFFF' },  // D4 dark red
}

function droughtLabel(maxTier: number): string {
  if (maxTier >= 5) return 'D4 — Exceptional Drought'
  if (maxTier >= 3) return 'D3 — Extreme Drought'
  if (maxTier >= 1) return 'D2 — Severe Drought'
  return 'No qualifying drought trigger'
}

function formatDateShort(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EstimateBadge() {
  return (
    <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 font-dm-sans">
      Estimate
    </span>
  )
}

function Divider() {
  return <div className="border-t border-forest-green/10" />
}

function TierRow({ tier, isMax }: { tier: LfpTierStatus; isMax: boolean }) {
  return (
    <div className={[
      'flex items-start justify-between gap-3 py-1.5',
      isMax ? 'font-semibold' : '',
    ].join(' ')}>
      <div className="flex min-w-0 items-start gap-2">
        <span className={[
          'mt-0.5 shrink-0 text-base leading-none',
          tier.triggered ? 'text-forest-green' : 'text-forest-green/25',
        ].join(' ')}>
          {tier.triggered ? '✓' : '✗'}
        </span>
        <span className={[
          'text-xs font-dm-sans leading-snug',
          tier.triggered ? 'text-forest-green' : 'text-forest-green/40',
        ].join(' ')}>
          <span className="font-semibold">Tier {tier.tier}</span> — {tier.label}
          {isMax && (
            <span className="ml-1.5 rounded-full bg-forest-green px-1.5 py-0.5 text-[10px] font-medium text-white">
              MAX
            </span>
          )}
        </span>
      </div>
      <span className={[
        'shrink-0 text-xs font-dm-sans tabular-nums',
        tier.triggered ? 'text-forest-green' : 'text-forest-green/30',
      ].join(' ')}>
        {tier.payments} pmt{tier.payments !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

// ─── Livestock Panel ─────────────────────────────────────────────────────────

function LivestockPanel({
  eligibility,
  fips,
  countyName,
}: {
  eligibility: LfpEligibilityResult | null
  fips: string
  countyName: string
}) {
  const [livestock, setLivestock] = useState<LivestockKind>('beef_adult')
  const [headCount, setHeadCount] = useState(100)
  const [showGrazingEdit, setShowGrazingEdit] = useState(false)
  const grazingPreset = getGrazingPreset(fips, 2025)
  const [gsInput, setGsInput] = useState(grazingPreset.startDate || '2025-10-01')
  const [geInput, setGeInput] = useState(grazingPreset.endDate || new Date().toISOString().slice(0, 10))

  useEffect(() => {
    const preset = getGrazingPreset(fips, 2025)
    setGsInput(preset.startDate || '2025-10-01')
    setGeInput(preset.endDate || new Date().toISOString().slice(0, 10))
  }, [fips])

  const router = useRouter()
  const searchParams = useSearchParams()
  const hasCustomDates = !!searchParams.get('gs') && !!searchParams.get('ge')
  const [dateError, setDateError] = useState<string | null>(null)

  function recalculate() {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRe.test(gsInput) || !dateRe.test(geInput)) {
      setDateError('Both dates must be in YYYY-MM-DD format.')
      return
    }
    setDateError(null)
    const url = `/dashboard?fips=${fips}&gs=${gsInput}&ge=${geInput}`
    router.push(url)
  }

  if (!eligibility) {
    return (
      <div className="space-y-3 p-4 sm:p-6">
        <p className="text-sm text-forest-green/50 font-dm-sans">
          LFP eligibility data not available — run the cron to populate drought data for this county.
        </p>
      </div>
    )
  }

  const { maxTier, payments, tiers, currentD2Streak, weeksUntilTier1, grazingPeriod, dataAsOf } = eligibility
  const style = TIER_STYLE[maxTier]
  const estimate = payments > 0
    ? estimatePayment(livestock, Math.max(1, headCount), payments)
    : null

  const headCountValid = Number.isFinite(headCount) && headCount > 0

  return (
    <div className="space-y-5 p-4 sm:p-6">

      {/* ── Status badge ── */}
      <div
        className="rounded-xl p-4"
        style={{ backgroundColor: style.bg }}
      >
        {maxTier > 0 ? (
          <div>
            <p
              className="font-dm-sans text-xs font-semibold uppercase tracking-wider"
              style={{ color: style.fg, opacity: 0.8 }}
            >
              {droughtLabel(maxTier)}
            </p>
            <p
              className="mt-1 font-fraunces text-4xl font-semibold tabular-nums sm:text-5xl"
              style={{ color: style.fg }}
            >
              {payments}
            </p>
            <p
              className="font-dm-sans text-sm"
              style={{ color: style.fg, opacity: 0.85 }}
            >
              monthly LFP payment{payments !== 1 ? 's' : ''} — {tiers.find(t => t.tier === maxTier)?.label}
            </p>
          </div>
        ) : (
          <div>
            <p className="font-dm-sans text-sm font-medium text-forest-green/60">
              Not yet qualifying for LFP payments
            </p>
            {weeksUntilTier1 !== null && (
              <p className="mt-2 font-dm-sans text-sm text-forest-green/80">
                {currentD2Streak > 0
                  ? `Currently in D2 — ${currentD2Streak} consecutive week${currentD2Streak !== 1 ? 's' : ''} so far. ${weeksUntilTier1} more week${weeksUntilTier1 !== 1 ? 's' : ''} of D2 needed to reach tier 1 (1 payment).`
                  : '4 consecutive weeks of D2 (Severe) drought required for the first LFP payment.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Payment calculator ── */}
      {maxTier > 0 && (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
                Payment Estimate
              </h3>
              <EstimateBadge />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-forest-green/60 font-dm-sans">
                  Livestock type
                </label>
                <select
                  value={livestock}
                  onChange={e => setLivestock(e.target.value as LivestockKind)}
                  className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
                >
                  {PAYMENT_RATES_2025.map(r => (
                    <option key={r.kind} value={r.kind}>
                      {r.label}{!r.rateConfirmed ? ' *' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-forest-green/60 font-dm-sans">
                  Head count
                </label>
                <input
                  type="number"
                  min={1}
                  value={headCount}
                  onChange={e => setHeadCount(parseInt(e.target.value, 10) || 0)}
                  className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
                />
              </div>
            </div>

            {estimate && headCountValid ? (
              <div className="rounded-lg bg-cream p-3">
                <p className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
                  {estimate.grossEstimate.toLocaleString('en-US', {
                    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
                  })}
                </p>
                <p className="mt-0.5 text-xs text-forest-green/60 font-dm-sans">
                  {headCount.toLocaleString()} {estimate.livestockLabel.toLowerCase()} ×{' '}
                  {estimate.monthlyRate.toLocaleString('en-US', {
                    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
                  })}/head/mo × {payments} payment{payments !== 1 ? 's' : ''} · 2025 rate
                </p>
                <p className="mt-1.5 text-xs text-forest-green/40 font-dm-sans">
                  Upper-bound estimate using the published 2025 FSA rate. Actual payment may be
                  lower if your acreage&apos;s normal carrying capacity produces a lower monthly
                  feed cost. FSA determines the final amount at enrollment.
                  {!PAYMENT_RATES_2025.find(r => r.kind === livestock)?.rateConfirmed && (
                    <> * Rate for this category estimated from FSA standard ratios — confirm with your FSA office.</>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-xs text-forest-green/40 font-dm-sans">Enter a valid head count to see estimate.</p>
            )}
          </div>

          <Divider />
        </>
      )}

      {/* ── Tier ladder ── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
          LFP Tier Ladder — {countyName}
        </p>
        <div className="divide-y divide-forest-green/10">
          {tiers.map(tier => (
            <TierRow key={tier.tier} tier={tier} isMax={tier.tier === maxTier && maxTier > 0} />
          ))}
        </div>
      </div>

      <Divider />

      {/* ── Grazing period ── */}
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
            Grazing Period
          </p>
          <p className="text-xs text-forest-green font-dm-sans">
            {formatDateShort(grazingPeriod.startDate)} → {formatDateShort(grazingPeriod.endDate)}
          </p>
          <button
            onClick={() => setShowGrazingEdit(v => !v)}
            className="text-xs text-forest-green/50 underline hover:text-forest-green font-dm-sans"
          >
            {showGrazingEdit ? 'Cancel' : 'Customize dates'}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-forest-green/40 font-dm-sans">
          {grazingPreset.source === 'county'
            ? `From confirmed FSA program records (${grazingPreset.sourceYear}). FSA assigns your actual period at signup.`
            : grazingPreset.source === 'default'
              ? 'Grazing period not on file for this county — showing estimate using program-year default (Oct 1, 2025 – today). Your actual FSA-assigned period depends on your forage type. Enter your real dates below or contact your local FSA office.'
              : 'Custom dates entered. Your actual period depends on your forage type — confirm with FSA at signup.'}
        </p>

        {(showGrazingEdit || grazingPreset.source === 'default') && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-forest-green/50 font-dm-sans">Start date</label>
                <input
                  type="date"
                  value={gsInput}
                  onChange={e => setGsInput(e.target.value)}
                  className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-forest-green/50 font-dm-sans">End date</label>
                <input
                  type="date"
                  value={geInput}
                  onChange={e => setGeInput(e.target.value)}
                  className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
                />
              </div>
            </div>
            <button
              onClick={recalculate}
              className="rounded-lg bg-forest-green px-4 py-2 text-sm font-medium text-white font-dm-sans hover:bg-forest-green/90"
            >
              Recalculate
            </button>
            {dateError && (
              <p className="text-xs text-red-600 font-dm-sans">{dateError}</p>
            )}
          </div>
        )}
      </div>

      <Divider />

      {/* ── OBBBA note ── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
        <p className="text-xs text-amber-800 font-dm-sans">
          <span className="font-semibold">OBBBA update:</span> Tiers 1 and 2 (D2 Severe
          triggers) are new under the One Big Beautiful Bill Act, effective July 2025. Pre-OBBBA,
          D2 conditions produced no LFP payment. Tier 1 (1 payment) now triggers at 4 consecutive
          weeks of D2; Tier 2 (2 payments) at 7 of any 8 weeks.
        </p>
      </div>

      {/* ── Provenance + disclaimer ── */}
      <div className="space-y-1">
        <p className="text-xs text-forest-green/40 font-dm-sans">
          USDM data as of {formatDateShort(dataAsOf)} ·{' '}
          <a
            href="https://droughtmonitor.unl.edu"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            U.S. Drought Monitor
          </a>
          {' · LFP eligibility cross-check: '}
          <a
            href="https://droughtmonitor.unl.edu/fsa"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            NDMC FSA Tool
          </a>
        </p>
        <p className="text-xs text-forest-green/50 font-dm-sans">
          This is an estimate based on U.S. Drought Monitor data. Your local FSA office makes
          the final eligibility and payment determination at signup.
        </p>
      </div>
    </div>
  )
}

// ─── Row Crop Panel ───────────────────────────────────────────────────────────

function RowCropPanel({
  eligibility,
  countyName,
}: {
  eligibility: LfpEligibilityResult | null
  countyName: string
}) {
  const qualifying = (eligibility?.maxTier ?? 0) >= 1

  return (
    <div className="space-y-5 p-4 sm:p-6">

      {/* Status */}
      <div className={[
        'rounded-xl p-4',
        qualifying
          ? 'bg-amber-50 ring-1 ring-amber-200'
          : 'bg-forest-green/5',
      ].join(' ')}>
        {qualifying ? (
          <div>
            <p className="font-dm-sans text-xs font-semibold uppercase tracking-wider text-amber-700">
              Secretarial Disaster Designation — Conditions Met
            </p>
            <p className="mt-2 font-dm-sans text-sm font-medium text-amber-900">
              You may be eligible to apply for FSA Emergency Loans (EM).
            </p>
          </div>
        ) : (
          <div>
            <p className="font-dm-sans text-xs font-semibold uppercase tracking-wider text-forest-green/50">
              No Qualifying Trigger
            </p>
            <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
              Significant drought conditions (typically D2 for 4+ consecutive weeks or D3 at any
              time) are required before a Secretarial Disaster Designation is issued.
            </p>
          </div>
        )}
      </div>

      {/* EM Loan explanation */}
      {qualifying && (
        <div className="space-y-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
              FSA Emergency Loans (EM)
            </h3>
            <ul className="mt-2 space-y-1.5">
              {[
                'Low-interest credit — not a payment or grant.',
                'Helps cover physical and production losses from disaster.',
                'Must apply at your local FSA service center during the application window.',
                'Eligibility requires a qualifying loss and a Secretarial Disaster Designation for your county.',
              ].map(item => (
                <li key={item} className="flex items-start gap-2 text-xs font-dm-sans text-forest-green/70">
                  <span className="mt-0.5 shrink-0 text-forest-green/40">–</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <a
            href="https://www.fsa.usda.gov/programs-and-services/farm-loan-programs/emergency-loan/index"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg border border-forest-green/20 px-3 py-2 text-xs font-medium text-forest-green font-dm-sans hover:bg-cream"
          >
            FSA Emergency Loan Program →
          </a>
        </div>
      )}

      <Divider />

      {/* Important: what we're NOT saying */}
      <div className="rounded-lg bg-cream p-3">
        <p className="text-xs font-semibold text-forest-green/60 font-dm-sans">Not shown here:</p>
        <p className="mt-1 text-xs text-forest-green/50 font-dm-sans">
          Emergency Relief Program (ERP) and Supplemental Disaster Relief Program (SDRP)
          eligibility depend on separate enrollment, crop insurance linkage, and FSA
          administrative determinations not derivable from USDM data alone. Contact your local
          FSA office for those programs.
        </p>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-forest-green/50 font-dm-sans">
        This is an estimate based on U.S. Drought Monitor data. A Secretarial Disaster
        Designation for {countyName} must be formally issued by the Secretary of Agriculture
        before Emergency Loans become available. Your local FSA office confirms eligibility.
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProgramStatus({
  eligibility,
  fips,
  countyName,
}: ProgramStatusProps) {
  const [mode, setMode] = useState<FarmerMode>('livestock')

  useEffect(() => {
    const stored = localStorage.getItem(FARMER_TYPE_KEY)
    if (stored === 'livestock' || stored === 'rowcrop') {
      setMode(stored)
    }
  }, [])

  function handleModeChange(next: FarmerMode) {
    setMode(next)
    localStorage.setItem(FARMER_TYPE_KEY, next)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm">

      {/* Header + toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">
          Program Status
        </h2>

        {/* Farmer toggle */}
        <div className="flex rounded-lg border border-forest-green/15 bg-cream p-0.5">
          {(['livestock', 'rowcrop'] as const).map(m => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={[
                'rounded-md px-3 py-1.5 text-xs font-semibold font-dm-sans transition-colors',
                mode === m
                  ? 'bg-forest-green text-white'
                  : 'text-forest-green/60 hover:text-forest-green',
              ].join(' ')}
            >
              {m === 'livestock' ? 'Livestock' : 'Row Crop'}
            </button>
          ))}
        </div>
      </div>

      {/* Panels — instant swap, no animation */}
      {mode === 'livestock' && (
        <LivestockPanel eligibility={eligibility} fips={fips} countyName={countyName} />
      )}
      {mode === 'rowcrop' && (
        <RowCropPanel eligibility={eligibility} countyName={countyName} />
      )}
    </div>
  )
}
