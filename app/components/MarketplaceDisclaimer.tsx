// Verbatim, approved marketplace disclaimer. Rendered on the hay create form and
// on listing detail pages. No hooks, so it imports cleanly into client trees.
export default function MarketplaceDisclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`font-dm-sans text-xs leading-relaxed text-forest-green/50 ${className}`}>
      Dryline is a venue for buyers and sellers to connect. We are not a party to any
      transaction and do not inspect, verify, or guarantee listings, prices, quantities,
      quality, or user identity. All transactions are solely between buyer and seller. Verify
      details independently and comply with applicable laws.
    </p>
  )
}
