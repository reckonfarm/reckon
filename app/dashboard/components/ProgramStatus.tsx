'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LfpEligibilityResult, LfpTierStatus } from '@/lib/lfp-eligibility'
import {
  estimatePayment,
  PAYMENT_RATES_2026,
  DAILY_FEED_RATE_2026,
  type LivestockKind,
  type LfpPaymentEstimate,
} from '@/lib/lfp-payment'
import { getGrazingPeriods, getGrazingPeriod, type GrazingPeriodEntry } from '@/lib/grazing-periods'
import LfpDisclaimer from '@/app/components/LfpDisclaimer'
import LfpEstimateNote from '@/app/components/LfpEstimateNote'
import EmDesignationNote from '@/app/components/EmDesignationNote'

// localStorage key for the Livestock/Row-Crop mode toggle.
const FARMER_TYPE_KEY = 'farmer_type'
import { trackEvent, bucketHeadCount } from '@/lib/analytics'

// ─── Types ────────────────────────────────────────────────────────────────────

type FarmerMode = 'livestock' | 'rowcrop'

export interface ProgramStatusProps {
  eligibility: LfpEligibilityResult | null
  priorYearEligibility: LfpEligibilityResult | null
  fips: string
  countyName: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIER_STYLE: Record<number, { bg: string; fg: string }> = {
  0: { bg: '#F3F4F6', fg: '#6B7280' },
  1: { bg: '#FFAA00', fg: '#451A00' },
  2: { bg: '#FFAA00', fg: '#451A00' },
  3: { bg: '#E60000', fg: '#FFFFFF' },
  4: { bg: '#E60000', fg: '#FFFFFF' },
  5: { bg: '#730000', fg: '#FFFFFF' },
  6: { bg: '#730000', fg: '#FFFFFF' },
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

function usd(n: number, decimals = 2) {
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
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
    <div className={`flex items-start gap-3 py-2 ${isMax ? 'opacity-100' : 'opacity-60'}`}>
      <span className={`mt-0.5 flex-shrink-0 text-sm font-dm-sans leading-none w-4 ${tier.triggered ? 'text-forest-green' : 'text-forest-green/25'}`}>
        {tier.triggered ? '✓' : '✗'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className={`font-dm-sans text-xs ${tier.triggered ? 'text-forest-green font-medium' : 'text-forest-green/40'}`}>
            Tier {tier.tier} — {tier.label}
            {isMax && tier.triggered && (
              <span className="ml-2 inline-block rounded-full bg-forest-green px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-cream">
                Max
              </span>
            )}
          </span>
          <span className={`font-dm-sans text-xs tabular-nums flex-shrink-0 ${tier.triggered ? 'text-forest-green/70' : 'text-forest-green/30'}`}>
            {tier.payments} pmt{tier.payments !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Payment breakdown display ────────────────────────────────────────────────

function PaymentBreakdown({
  est,
  tierLabel,
}: {
  est: LfpPaymentEstimate
  tierLabel: string
}) {
  const limitingCost = est.limitingStep === 2 ? est.step2! : est.step1

  return (
    <div className="mt-2 space-y-1 rounded-md bg-forest-green/5 px-3 py-2.5 font-dm-sans text-xs text-forest-green/70">
      {/* Step 1 */}
      <div className="flex justify-between gap-2">
        <span>
          Step 1 — head count:{' '}
          <span className="text-forest-green/50">
            {est.headCount.toLocaleString()} × {usd(est.ratePerHead)}/head
          </span>
        </span>
        <span className="tabular-nums text-forest-green/80 font-medium">
          {usd(est.step1)}/mo
        </span>
      </div>

      {/* Step 2 */}
      {est.step2 !== null ? (
        <div className="flex justify-between gap-2">
          <span>
            Step 2 — carrying cap:{' '}
            <span className="text-forest-green/50">
              ({est.eligibleAcres?.toLocaleString()} acres ÷ {est.acresPerAU} ac/AU) × 30 × {usd(DAILY_FEED_RATE_2026, 4)}/day
            </span>
          </span>
          <span className="tabular-nums text-forest-green/80 font-medium">
            {usd(est.step2)}/mo
          </span>
        </div>
      ) : (
        <div className="text-forest-green/40">
          Step 2 — carrying cap: not entered (head-count method used)
        </div>
      )}

      {/* 60% line */}
      <div className="flex justify-between gap-2 border-t border-forest-green/10 pt-1">
        <span>
          FSA pays 60% of{' '}
          <span className={est.step2 !== null ? 'font-semibold text-forest-green' : ''}>
            {est.step2 !== null
              ? `Step ${est.limitingStep} (${est.limitingStep === 2 ? 'carrying cap is less' : 'head count is less'})`
              : 'Step 1'}
          </span>
          {': '}
          <span className="text-forest-green/50">{usd(limitingCost)} × 0.60</span>
        </span>
        <span className="tabular-nums text-forest-green/80 font-medium">
          {usd(est.monthlyPayment)}/mo
        </span>
      </div>

      {/* × months */}
      <div className="flex justify-between gap-2">
        <span>
          × {est.numPayments} monthly payment{est.numPayments !== 1 ? 's' : ''}{' '}
          <span className="text-forest-green/50">({tierLabel})</span>
        </span>
        <span className="tabular-nums font-semibold text-forest-green">
          {usd(est.grossEstimate, 0)}
        </span>
      </div>

      {/* Program-year cap */}
      {est.isCapped && (
        <div className="flex justify-between gap-2 border-t border-forest-green/10 pt-1">
          <span>
            Capped at program limit{' '}
            <span className="text-forest-green/50">({usd(est.paymentCap, 0)}/yr per person)</span>
          </span>
          <span className="tabular-nums font-semibold text-rust">
            {usd(est.cappedEstimate, 0)}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFsaDate(period: GrazingPeriodEntry | null, field: 'start' | 'end'): string {
  if (!period) return ''
  const mmdd    = field === 'start' ? period.start : period.end
  const current = new Date().getFullYear()
  const startMM = parseInt(period.start.slice(0, 2), 10)
  const endMM   = parseInt(period.end.slice(0, 2), 10)
  const year = (field === 'end' && endMM < startMM) ? current + 1 : current
  return `${year}-${mmdd}`
}

// ─── Pulse indicator ─────────────────────────────────────────────────────────

function PulseIndicator() {
  return (
    <span className="relative ml-2 inline-flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-50" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white/80" />
    </span>
  )
}

// ─── Action Cards ────────────────────────────────────────────────────────────

function ActionCards({ year, currentYear }: {
  year: 'current' | 'prior'
  currentYear: number
}) {
  const programYear = year === 'current' ? currentYear : currentYear - 1
  const deadlineYear = programYear + 1
  const signupClosed = year === 'prior'

  return (
    <div id="action-cards" className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
        Next Steps
      </p>

      <div className="rounded-xl border border-forest-green/10 bg-cream divide-y divide-forest-green/8">

        {/* Step 1 */}
        <div className="flex gap-3 p-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-forest-green/8">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-forest-green/70">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-forest-green font-dm-sans">
              1. Report your acreage
            </p>
            <p className="mt-0.5 text-xs text-forest-green/60 font-dm-sans leading-relaxed">
              File an acreage report for all grazing land where the loss occurred. Required before your application can be approved.
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex gap-3 p-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-forest-green/8">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-forest-green/70">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-forest-green font-dm-sans">
              2. Contact your FSA office
            </p>
            <p className="mt-0.5 text-xs text-forest-green/60 font-dm-sans leading-relaxed">
              Call or visit your local FSA office to begin your LFP application. Bring livestock inventory records and grazing land documentation.
            </p>
            <a href="https://www.farmers.gov/service-center-locator" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-forest-green underline underline-offset-2 font-dm-sans">
              Find your FSA office →
            </a>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex gap-3 p-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-forest-green/8">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-forest-green/70">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-forest-green font-dm-sans">
              3. Complete Form CCC-853
            </p>
            <p className="mt-0.5 text-xs text-forest-green/60 font-dm-sans leading-relaxed">
              Submit the LFP application with supporting documentation to your FSA county office.
            </p>
            <a href="https://www.fsa.usda.gov/Assets/USDA-FSA-Public/usdafiles/Farm-Bill/pdf/ccc853.pdf" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-forest-green underline underline-offset-2 font-dm-sans">
              Download Form CCC-853 →
            </a>
          </div>
        </div>

        {/* Step 4 — deadline */}
        <div className="flex gap-3 p-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-forest-green/8">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-forest-green/70">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-forest-green font-dm-sans">
              4. File by the deadline
            </p>
            {signupClosed ? (
              <p className="mt-0.5 text-xs text-forest-green/60 font-dm-sans leading-relaxed">
                Applications for {programYear} losses were due March 1, {deadlineYear}. Contact your FSA office if you have not yet enrolled.
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-forest-green/60 font-dm-sans leading-relaxed">
                Applications for {programYear} losses are due by March 1, {deadlineYear}. Do not wait — FSA offices get busy as the deadline approaches.
              </p>
            )}
          </div>
        </div>

        {/* Step 5 — form pre-fill hook (future feature) */}
        <div className="flex gap-3 p-3 bg-forest-green/[0.03] rounded-b-xl">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-forest-green/8">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-forest-green/70">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-forest-green font-dm-sans">
              5. Pre-filled application
            </p>
            <p className="mt-0.5 text-xs text-forest-green/60 font-dm-sans leading-relaxed">
              Coming soon — Dryline will pre-fill your CCC-853 with your county, drought dates, and livestock data so you walk into your FSA office ready to sign.
            </p>
            <span className="mt-1 inline-block rounded-full bg-forest-green/10 px-2 py-0.5 text-xs font-semibold text-forest-green/70 font-dm-sans">
              Coming soon
            </span>
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Livestock Panel ─────────────────────────────────────────────────────────

function LivestockPanel({
  eligibility,
  fips,
  countyName,
  year,
}: {
  eligibility: LfpEligibilityResult | null
  fips: string
  countyName: string
  year: 'current' | 'prior'
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const allTypes = getGrazingPeriods(fips)
  const typeNames = allTypes ? Object.keys(allTypes) : []

  const resolveInitialType = (fp: string, sp: ReturnType<typeof useSearchParams>) => {
    const ptParam = sp.get('pt')
    const types = getGrazingPeriods(fp)
    if (ptParam && types?.[ptParam]) return ptParam
    if (types?.['Native Pasture']) return 'Native Pasture'
    return Object.keys(types ?? {})[0] ?? ''
  }

  const [selectedType, setSelectedType]       = useState(() => resolveInitialType(fips, searchParams))
  const fsaPeriod: GrazingPeriodEntry | null   = (selectedType && allTypes?.[selectedType])
    ? allTypes[selectedType]
    : getGrazingPeriod(fips)

  const [livestock, setLivestock]       = useState<LivestockKind>('beef_adult')
  const [headCount, setHeadCount]       = useState(100)
  // True once the rancher edits the estimate inputs — keeps the analytics event
  // tied to a real "I ran an estimate", not the default values shown on load.
  const [estimateTouched, setEstimateTouched] = useState(false)
  const [eligibleAcres, setEligibleAcres] = useState<string>('')
  const [acresPerAU, setAcresPerAU]     = useState<string>('')
  const [showGrazingEdit, setShowGrazingEdit] = useState(false)
  const [gsInput, setGsInput]           = useState(() => buildFsaDate(fsaPeriod, 'start'))
  const [geInput, setGeInput]           = useState(() => buildFsaDate(fsaPeriod, 'end'))

  useEffect(() => {
    const types = getGrazingPeriods(fips)
    const ptParam = searchParams.get('pt')
    const defaultType = (ptParam && types?.[ptParam]) ? ptParam : (types?.['Native Pasture'] ? 'Native Pasture' : Object.keys(types ?? {})[0] ?? '')
    setSelectedType(defaultType)
    const period = (defaultType && types?.[defaultType]) ? types[defaultType] : getGrazingPeriod(fips)
    setGsInput(buildFsaDate(period, 'start'))
    setGeInput(buildFsaDate(period, 'end'))
  }, [fips])

  const [dateError, setDateError] = useState<string | null>(null)

  // Fire lfp_estimate_run once the rancher has engaged the inputs and the county
  // actually yields a payment-eligible estimate. Debounced so typing a head
  // count doesn't spray events; bucketed so we never log the raw number.
  const headCountBucket = bucketHeadCount(headCount)
  const estimateReady =
    !!eligibility && eligibility.payments > 0 && Number.isFinite(headCount) && headCount > 0
  useEffect(() => {
    if (!estimateTouched || !estimateReady) return
    const t = setTimeout(() => {
      trackEvent('lfp_estimate_run', { fips, head_count_bucket: headCountBucket })
    }, 800)
    return () => clearTimeout(t)
  }, [estimateTouched, estimateReady, fips, headCountBucket])

  function handleTypeChange(typeName: string) {
    setSelectedType(typeName)
    if (allTypes?.[typeName]) {
      setGsInput(buildFsaDate(allTypes[typeName], 'start'))
      setGeInput(buildFsaDate(allTypes[typeName], 'end'))
    }
    const params = new URLSearchParams(searchParams.toString())
    params.set('pt', typeName)
    params.delete('gs')
    params.delete('ge')
    router.push(`/dashboard?${params.toString()}`)
  }

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

  // FSA-enforcement gate — the SAME engine field the sibling surfaces read (TriggeredBanner /
  // LfpHero / LfpAlertCard). 'pending_obbba' = meets OBBBA's new D2 threshold but FSA hasn't
  // loaded it into the 2026 maps: no dollar, no "triggered" / sign-up framing. Derived from
  // THIS panel's eligibility so the prior-year toggle stays honest per that year's result.
  const official = eligibility.enforcement === 'officially_eligible'
  const pending  = eligibility.enforcement === 'pending_obbba'

  const headCountValid   = Number.isFinite(headCount) && headCount > 0
  const acresVal         = eligibleAcres !== '' ? parseFloat(eligibleAcres) : null
  const acresPerAUVal    = acresPerAU !== '' ? parseFloat(acresPerAU) : null
  const acresInputValid  = (acresVal === null || (Number.isFinite(acresVal) && acresVal > 0))
                        && (acresPerAUVal === null || (Number.isFinite(acresPerAUVal) && acresPerAUVal > 0))

  const estimate: LfpPaymentEstimate | null = (payments > 0 && headCountValid && acresInputValid)
    ? estimatePayment(
        livestock,
        Math.max(1, headCount),
        payments,
        {
          eligibleAcres: acresVal ?? undefined,
          acresPerAU:    acresPerAUVal ?? undefined,
        },
      )
    : null

  const maxTierDef  = tiers.find(t => t.tier === maxTier)
  const tierLabel   = maxTierDef?.label ?? ''

  return (
    <div className="space-y-5 p-4 sm:p-6">

      {/* ── Status badge ── */}
      {pending ? (
        // Pending — meets OBBBA's new D2 threshold but NOT officially triggered. Amber, no
        // dollar, no "triggered"/sign-up call — same story as the banner/hero/alert siblings.
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="font-dm-sans text-xs font-semibold uppercase tracking-wider text-amber-700">
            {droughtLabel(maxTier)}
          </p>
          <p className="mt-1 font-fraunces text-xl font-semibold text-amber-900 sm:text-2xl">
            Meets the new OBBBA D2 threshold — not yet official
          </p>
          <p className="mt-2 font-dm-sans text-sm leading-relaxed text-amber-800">
            FSA hasn&apos;t loaded the OBBBA rules into the 2026 eligibility maps yet, so this
            isn&apos;t officially triggered and there&apos;s no payment estimate. Keep your
            records, and{' '}
            <a
              href="https://www.farmers.gov/working-with-us/service-center-locator"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-amber-900 underline hover:text-amber-700"
            >
              check with your county FSA office
            </a>.
          </p>
        </div>
      ) : (
      <div
        className="rounded-xl p-4"
        style={{ backgroundColor: style.bg }}
      >
        {maxTier > 0 && official ? (
          <div>
            <div className="flex items-center">
              <p
                className="font-dm-sans text-xs font-semibold uppercase tracking-wider"
                style={{ color: style.fg, opacity: 0.8 }}
              >
                {droughtLabel(maxTier)}
              </p>
              <PulseIndicator />
            </div>
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
              monthly LFP payment{payments !== 1 ? 's' : ''} — {tierLabel}
            </p>
            <p
              className="mt-2 font-dm-sans text-sm font-medium"
              style={{ color: style.fg, opacity: 0.9 }}
            >
              You&apos;re triggered. Don&apos;t wait — sign up at your local FSA office.
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
      )}

      {/* Prominent estimate disclaimer right under the eligibility result — shows
          for both the qualifying and "not yet qualifying" states. */}
      <LfpEstimateNote />

      {/* Next-steps + calculator are OFFICIAL-only: the sign-up call-to-action and the payout
          math would be false claims on a pending_obbba (or any non-official) county. */}
      {official && maxTier > 0 && (
        <ActionCards year={year} currentYear={new Date().getFullYear()} />
      )}

      {/* ── Payment calculator ── */}
      {official && maxTier > 0 && (
        <>
          <div className="space-y-3">

            {/* Header */}
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
                Payment Estimate
              </h3>
              <EstimateBadge />
            </div>

            {/* 60% explanation */}
            <p className="text-xs text-forest-green/60 font-dm-sans">
              FSA pays <span className="font-semibold text-forest-green/80">60%</span> of your
              monthly feed cost, for the number of months your county&apos;s drought qualifies.
              The 60% is applied to whichever is smaller — your herd&apos;s feed cost, or what
              your land can support by carrying capacity.
            </p>

            {/* Livestock + head count */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-forest-green/60 font-dm-sans">
                  Livestock type
                </label>
                <select
                  value={livestock}
                  onChange={e => { setLivestock(e.target.value as LivestockKind); setEstimateTouched(true) }}
                  className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
                >
                  {PAYMENT_RATES_2026.map(r => (
                    <option key={r.kind} value={r.kind}>{r.label}</option>
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
                  onChange={e => { setHeadCount(parseInt(e.target.value, 10) || 0); setEstimateTouched(true) }}
                  className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
                />
              </div>
            </div>

            {/* Carrying capacity (optional) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-forest-green/60 font-dm-sans">
                  Eligible grazing acres{' '}
                  <span className="font-normal text-forest-green/35">(optional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 640"
                  value={eligibleAcres}
                  onChange={e => setEligibleAcres(e.target.value)}
                  className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green placeholder:text-forest-green/25 focus:outline-none focus:ring-2 focus:ring-forest-green/30"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-forest-green/60 font-dm-sans">
                  Carrying capacity — acres per AU{' '}
                  <span className="font-normal text-forest-green/35">(optional)</span>
                </label>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  placeholder="e.g. 5"
                  value={acresPerAU}
                  onChange={e => setAcresPerAU(e.target.value)}
                  className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green placeholder:text-forest-green/25 focus:outline-none focus:ring-2 focus:ring-forest-green/30"
                />
              </div>
            </div>

            {/* Estimate card */}
            {estimate && headCountValid ? (
              <div className="rounded-lg border border-forest-green/10 bg-cream p-3">
                <div className="flex items-baseline gap-2">
                  <p className="font-fraunces text-3xl font-semibold text-forest-green sm:text-4xl">
                    {usd(estimate.cappedEstimate, 0)}
                  </p>
                  <span className="rounded-full bg-forest-green px-2 py-0.5 font-dm-sans text-xs font-semibold text-white">
                    ✓ triggered
                  </span>
                </div>
                {estimate.isCapped && (
                  <p className="mt-0.5 text-xs font-medium text-rust font-dm-sans">
                    Estimated {usd(estimate.grossEstimate, 0)}; capped at {usd(estimate.paymentCap, 0)} program-year limit.
                  </p>
                )}
                <p className="mt-0.5 text-xs text-forest-green/50 font-dm-sans">
                  2026 FSA rate · head-count{estimate.step2 !== null
                    ? estimate.limitingStep === 2 ? ' · carrying cap is limiting factor' : ' · head count is limiting factor'
                    : ' method (enter acres for carrying-cap comparison)'}
                </p>

                <PaymentBreakdown est={estimate} tierLabel={tierLabel} />

                <p className="mt-2 text-xs text-forest-green/40 font-dm-sans">
                  Maximum LFP payment is 5 monthly payments per livestock category per
                  calendar year. FSA determines the final amount at enrollment — this estimate
                  does not account for payment limitations, sequestration, or prior-year
                  mitigated livestock adjustments.
                </p>

                <div className="mt-2">
                  <LfpEstimateNote />
                </div>
              </div>
            ) : (
              <p className="text-xs text-forest-green/40 font-dm-sans">
                {headCountValid ? 'Enter a valid head count to see estimate.' : 'Enter a valid head count to see estimate.'}
              </p>
            )}
          </div>

          <Divider />
        </>
      )}

      {/* ── Tier ladder ── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
          LFP Tier Ladder — {countyName}{pending ? ' (OBBBA — pending FSA)' : ''}
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
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
          Grazing Period
        </p>

        {allTypes && typeNames.length > 0 && (
          <div className="mb-1">
            {typeNames.length === 1 ? (
              <p className="text-sm font-medium text-forest-green font-dm-sans">{typeNames[0]}</p>
            ) : (
              <select
                value={selectedType}
                onChange={e => handleTypeChange(e.target.value)}
                className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 text-sm font-dm-sans text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
              >
                {typeNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            )}
            <p className="mt-0.5 text-xs text-forest-green/40 font-dm-sans">
              FSA Official · {fsaPeriod?.year ?? ''}
            </p>
          </div>
        )}

        {!allTypes && (
          <p className="mb-1 text-xs text-forest-green/40 font-dm-sans">
            Grazing period not on file for this county. Your actual FSA-assigned period depends on your forage type. Enter your dates below or contact your local FSA office.
          </p>
        )}

        <div className="flex flex-wrap items-baseline gap-2">
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

        {(showGrazingEdit || !fsaPeriod) && (
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
              style={{ color: '#ffffff' }}
              className="rounded-lg bg-forest-green px-4 py-2 text-sm font-medium font-dm-sans hover:bg-forest-green/90"
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

      {/* ── Provenance ── */}
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
      </div>
    </div>
  )
}

// ─── Row Crop Panel ───────────────────────────────────────────────────────────

function RowCropPanel({
  eligibility,
}: {
  eligibility: LfpEligibilityResult | null
}) {
  // Missing data must NEVER read as "your county doesn't qualify" — the prior-year
  // eligibility can resolve to null. Show an honest data-unavailable state instead.
  if (!eligibility) {
    return (
      <div className="space-y-3 p-4 sm:p-6">
        <p className="text-sm leading-relaxed text-forest-green/60 font-dm-sans">
          Drought eligibility data isn&apos;t available for this period — this is{' '}
          <span className="font-medium text-forest-green/80">not</span> a finding that your county
          doesn&apos;t qualify. Check back shortly, or confirm with your county FSA office.
        </p>
      </div>
    )
  }

  const longestRun = Math.max(eligibility.longestD2Run, eligibility.currentD2Streak)
  const qualifying =
    longestRun >= 8 ||
    (eligibility.tiers[2]?.triggered ?? false) ||
    (eligibility.tiers[4]?.triggered ?? false)

  return (
    <div className="space-y-5 p-4 sm:p-6">

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
              D2 for 8+ consecutive weeks, or D3 or D4 at any point during the growing season,
              triggers a Secretarial Disaster Designation under 7 CFR Part 759.
            </p>
          </div>
        )}
      </div>

      {/* Prominent disclaimer — same visual weight as the claim above, shown for
          BOTH the qualifying and non-qualifying states. Covers the contiguous-county
          and crop-window nuances honestly without changing the trigger math. */}
      <EmDesignationNote />

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

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-forest-green/50 font-dm-sans">
              Emergency Conservation Program (ECP)
            </h3>
            <p className="mt-2 text-xs font-dm-sans text-forest-green/70">
              A <span className="font-medium text-forest-green">separate</span> program — not triggered by
              this drought designation. ECP cost-shares rehabilitation of disaster-damaged farmland and
              drought water infrastructure, and requires its own FSA-approved signup. Contact your local FSA
              office.
            </p>
            <a
              href="https://www.fsa.usda.gov/programs-and-services/conservation-programs/emergency-conservation/index"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block rounded-lg border border-forest-green/20 px-3 py-2 text-xs font-medium text-forest-green font-dm-sans hover:bg-cream"
            >
              FSA Emergency Conservation Program →
            </a>
          </div>
        </div>
      )}

      <Divider />

      <div className="rounded-lg bg-cream p-3">
        <p className="text-xs font-semibold text-forest-green/60 font-dm-sans">Not shown here:</p>
        <p className="mt-1 text-xs text-forest-green/50 font-dm-sans">
          Emergency Relief Program (ERP) and Supplemental Disaster Relief Program (SDRP)
          eligibility depend on separate enrollment, crop insurance linkage, and FSA
          administrative determinations not derivable from USDM data alone. Contact your local
          FSA office for those programs.
        </p>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProgramStatus({
  eligibility,
  priorYearEligibility,
  fips,
  countyName,
}: ProgramStatusProps) {
  const [mode, setMode] = useState<FarmerMode>('livestock')
  const [year, setYear] = useState<'current' | 'prior'>('current')

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

  const activeEligibility = year === 'current' ? eligibility : priorYearEligibility
  const currentYear = eligibility?.grazingPeriod.startDate.slice(0, 4) ?? String(new Date().getFullYear())
  const priorYear   = priorYearEligibility?.grazingPeriod.startDate.slice(0, 4) ?? String(new Date().getFullYear() - 1)

  return (
    <Card shadow="soft" className="overflow-hidden">

      {eligibility && eligibility.maxTier >= 1 && eligibility.enforcement === 'officially_eligible' && (
        <div className="mb-6 rounded-xl bg-forest-green px-5 py-4 text-cream">
          <p className="font-dm-sans text-xs font-medium text-cream/60 uppercase tracking-wide mb-1">Estimated payment</p>
          <p className="font-fraunces text-3xl font-semibold text-cream">
            ~${Math.round(estimatePayment('beef_adult', 100, eligibility.payments).cappedEstimate).toLocaleString()}
          </p>
          <p className="font-dm-sans text-xs text-cream/60 mt-1">
            Based on 100 head beef cattle · {eligibility.payments} payment{eligibility.payments !== 1 ? 's' : ''} · Tier {eligibility.maxTier}
          </p>
          <div className="mt-3">
            <LfpEstimateNote tone="onDark" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <Heading level={5}>
          Program Status
        </Heading>

        <div className="flex flex-wrap items-center gap-2">
          {priorYearEligibility && (
            <div className="flex rounded-lg border border-forest-green/15 bg-cream p-0.5">
              {(['current', 'prior'] as const).map(y => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  style={year === y ? { color: '#ffffff' } : undefined}
                  className={[
                    'rounded-md px-3 py-1.5 text-xs font-semibold font-dm-sans transition-colors',
                    year === y
                      ? 'bg-forest-green'
                      : 'text-forest-green/60 hover:text-forest-green',
                  ].join(' ')}
                >
                  {y === 'current' ? currentYear : priorYear}
                </button>
              ))}
            </div>
          )}

          <div className="flex rounded-lg border border-forest-green/15 bg-cream p-0.5">
            {(['livestock', 'rowcrop'] as const).map(m => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                style={mode === m ? { color: '#ffffff' } : undefined}
                className={[
                  'rounded-md px-3 py-1.5 text-xs font-semibold font-dm-sans transition-colors',
                  mode === m
                    ? 'bg-forest-green'
                    : 'text-forest-green/60 hover:text-forest-green',
                ].join(' ')}
              >
                {m === 'livestock' ? 'Livestock' : 'Row Crop'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {year === 'prior' && (
        <div className="border-b border-forest-green/10 bg-amber-50/70 px-4 py-2 sm:px-6">
          <p className="text-xs text-amber-800 font-dm-sans">
            {priorYear} LFP signup closed March 1, {String(parseInt(priorYear) + 1)}. Contact your FSA office if you have not enrolled.
          </p>
        </div>
      )}

      {mode === 'livestock' && (
        <LivestockPanel eligibility={activeEligibility} fips={fips} countyName={countyName} year={year} />
      )}
      {mode === 'rowcrop' && (
        <RowCropPanel eligibility={activeEligibility} />
      )}

      <div className="border-t border-forest-green/10 px-4 py-4 sm:px-6">
        <LfpDisclaimer />
      </div>
    </Card>
  )
}
