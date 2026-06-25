// Verification script — run with: npx tsx lib/test-lfp.ts
// Computes LFP eligibility + payment estimate for 3 known-drought counties
// and logs results for manual cross-check against droughtmonitor.unl.edu/fsa

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

const TEST_COUNTIES = [
  { fips: '48011', label: 'Armstrong TX',  expectedTier: '6 (D4 ≥4 weeks → 5 payments)', expectedEnforcement: 'officially_eligible (D3+ enforceable today)' },
  { fips: '31003', label: 'Antelope NE',   expectedTier: '3 or 4 (D3 tier)',             expectedEnforcement: 'officially_eligible (D3 tier)'              },
  { fips: '30069', label: 'Petroleum MT',  expectedTier: '1 (D2 ≥4 consec, no D3/D4)',   expectedEnforcement: 'pending_obbba (D2-only, 4–7 wk run, FSA maps not yet flipped)' },
] as const

const SAMPLE_HEAD = 100

async function main() {
  // Dynamic imports so loadEnvConfig runs before supabase.ts reads env vars at module level
  const { computeLfpEligibility } = await import('./lfp-eligibility')
  const { estimatePayment, formatPaymentLine } = await import('./lfp-payment')

  console.log('\nLFP Eligibility Verification')
  console.log('Program year: Oct 1, 2025 → present (default grazing period)')
  console.log('Data source: USDM consecutive-weeks API + local drought_data (7-of-8 check)')
  console.log('Cross-check against: https://droughtmonitor.unl.edu/fsa\n')

  for (const { fips, label, expectedTier, expectedEnforcement } of TEST_COUNTIES) {
    const bar = '─'.repeat(64)
    console.log(bar)
    console.log(`${label}  (FIPS ${fips})`)
    console.log(`Expected tier: ${expectedTier}`)
    console.log(`Expected enforcement: ${expectedEnforcement}`)

    const result = await computeLfpEligibility(fips)

    if (!result) {
      console.log('  ERROR: county not found in database\n')
      continue
    }

    console.log(`  County:         ${result.countyName}, ${result.state}`)
    console.log(`  Grazing period: ${result.grazingPeriod.startDate} → ${result.grazingPeriod.endDate}`)
    console.log(`  Data as of:     ${result.dataAsOf} (latest USDM week in DB)`)
    console.log(`  Max tier:       ${result.maxTier} / 6   →   ${result.payments} monthly payment${result.payments !== 1 ? 's' : ''}`)
    console.log(`  Enforcement:    ${result.enforcement}   (D2 ≥8-wk old rule: ${result.d2EightWeek === null ? 'unconfirmed' : result.d2EightWeek})`)

    // Enforcement invariants — D3+ counties are FSA-enforceable today; a D2-only county
    // with no ≥8-week run is pending until FSA loads the OBBBA D2 thresholds (OBBBA_FSA_IMPLEMENTED).
    const obbbaD2Only = (result.tiers[0].triggered || result.tiers[1].triggered) &&
      !result.tiers.slice(2).some(t => t.triggered)
    const d3OrWorse = result.tiers.slice(2).some(t => t.triggered)
    if (d3OrWorse && result.enforcement !== 'officially_eligible') {
      throw new Error(`ASSERT FAILED ${label}: D3+ county must be officially_eligible, got ${result.enforcement}`)
    }
    if (obbbaD2Only && result.d2EightWeek === false && result.enforcement !== 'pending_obbba') {
      throw new Error(`ASSERT FAILED ${label}: D2-only <8wk county must be pending_obbba, got ${result.enforcement}`)
    }

    if (result.maxTier > 0) {
      const winning = result.tiers.find(t => t.tier === result.maxTier)!
      console.log(`  Trigger:        ${winning.label}`)
    }

    console.log('\n  Full tier ladder:')
    for (const t of result.tiers) {
      const mark = t.triggered ? '✓' : '✗'
      const arrow = t.tier === result.maxTier && result.maxTier > 0 ? ' ← MAX' : ''
      console.log(`    Tier ${t.tier} [${mark}]  ${t.label}  (${t.payments} payment${t.payments !== 1 ? 's' : ''})${arrow}`)
    }

    if (result.weeksUntilTier1 !== null) {
      if (result.currentD2Streak > 0) {
        console.log(
          `\n  ⏳ Currently in D2 — ${result.currentD2Streak} consecutive week${result.currentD2Streak !== 1 ? 's' : ''} so far.` +
          ` ${result.weeksUntilTier1} more week${result.weeksUntilTier1 !== 1 ? 's' : ''} of D2 needed to reach tier 1.`
        )
      } else {
        console.log(`\n  ⏳ Not currently in D2. 4 consecutive weeks of D2 needed to reach tier 1.`)
      }
    }

    if (result.payments > 0) {
      const est = estimatePayment('beef_adult', SAMPLE_HEAD, result.payments)
      console.log(`\n  Payment estimate (${SAMPLE_HEAD} adult beef head):`)
      console.log(`    ${formatPaymentLine(est)}`)
      console.log(`    Caveat: ${est.caveat}`)
    }

    console.log()
  }

  console.log('─'.repeat(64))
  console.log('OBBBA NOTE: Tiers 1 & 2 (D2 triggers) are new under OBBBA (July 2025).')
  console.log('Pre-OBBBA: D2 produced no LFP payment.')
  console.log('\nDISCLAIMER: All tiers and payment figures are estimates based on')
  console.log('U.S. Drought Monitor data. FSA confirms eligibility at signup.')
}

main().catch(err => { console.error(err); process.exit(1) })
