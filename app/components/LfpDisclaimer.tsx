// Verbatim, approved LFP / estimate disclaimer. Rendered on every surface that
// shows drought eligibility or an LFP payment estimate. Small, legible helper
// text — pass `className` to recolor on dark backgrounds (e.g. text-white/60).
// No hooks, so this is safe to import into both server and client components.
export default function LfpDisclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`font-dm-sans text-xs leading-relaxed text-forest-green/50 ${className}`}>
      Dryline is not affiliated with the USDA, the Farm Service Agency (FSA), or any
      government agency. Drought conditions, eligibility indicators, and any payment figures
      shown are unofficial estimates for planning only, based on U.S. Drought Monitor data and
      publicly available program rules — not a determination of eligibility or a guarantee of
      payment. Actual LFP eligibility and amounts are determined solely by FSA. To apply,
      contact your local FSA office and file form CCC-853 by the applicable deadline.
    </p>
  )
}
