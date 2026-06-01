// Prominent disclaimer for the row-crop / Secretarial Disaster Designation panel —
// same visual weight as LfpEstimateNote, but loan/designation wording (NOT the LFP
// acreage/livestock/payment-limits vocabulary). EM are LOANS, and the designation
// must be FORMALLY issued, so the caveat must carry the same weight as the claim.
// Also honestly covers the two correctness nuances from the audit (contiguous
// counties; the crop window differs) without engineering adjacency/season logic.
// No hooks → safe in server or client components.
export default function EmDesignationNote() {
  return (
    <p className="rounded-md border border-forest-green/15 bg-forest-green/[0.04] px-3 py-2 font-dm-sans text-xs leading-relaxed text-forest-green/75">
      <span className="font-semibold">Estimate only</span> — based on U.S. Drought Monitor data, not a
      determination. A Secretarial Disaster Designation must be formally issued before FSA Emergency Loans
      (which are loans, not payments) are available. Eligibility may also extend to counties adjacent to a
      triggered county, and the qualifying window can differ for crops. Confirm with your{' '}
      <a
        href="https://www.farmers.gov/service-center-locator"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-forest-green underline underline-offset-2"
      >
        county FSA office
      </a>.
    </p>
  )
}
