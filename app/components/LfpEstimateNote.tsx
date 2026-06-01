// Prominent, concise LFP estimate disclaimer — placed NEAR every LFP eligibility
// or payment figure (a visible note, not buried footer fine print). The trigger
// math is sound, but the actual payment depends on things Dryline can't see
// (certified acreage, covered livestock, the $125k cap, grazing timing, FSA
// filing), so every result must say so plainly and point to the county FSA office.
//
// tone='light'  → forest-green callout box on cream/white surfaces.
// tone='onDark' → readable white text for the dark forest-green banners.
// No hooks → safe in both server and client components.
export default function LfpEstimateNote({ tone = 'light' }: { tone?: 'light' | 'onDark' }) {
  const dark = tone === 'onDark'
  return (
    <p
      className={[
        'font-dm-sans text-xs leading-relaxed',
        dark
          ? 'text-white/80'
          : 'rounded-md border border-forest-green/15 bg-forest-green/[0.04] px-3 py-2 text-forest-green/75',
      ].join(' ')}
    >
      <span className="font-semibold">Estimate only</span> — not a guarantee of eligibility or payment.
      Actual LFP payments depend on your certified acreage, livestock, payment limits, and FSA filing.{' '}
      Confirm with your{' '}
      <a
        href="https://www.farmers.gov/service-center-locator"
        target="_blank"
        rel="noopener noreferrer"
        className={dark ? 'font-medium text-white underline underline-offset-2' : 'font-semibold text-forest-green underline underline-offset-2'}
      >
        county FSA office
      </a>.
    </p>
  )
}
