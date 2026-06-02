import Link from 'next/link'

// Site-wide footer for public pages (homepage, hay marketplace, seller profiles).
// Mirrors the legal-link strip used in the dashboard footer so the links to the
// Terms and Privacy Policy are reachable everywhere, not just behind sign-in.
export default function SiteFooter() {
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <p className="text-center font-dm-sans text-xs text-forest-green/40">
        <Link href="/terms" className="underline hover:text-forest-green/70">Terms</Link>
        {' · '}
        <Link href="/privacy" className="underline hover:text-forest-green/70">Privacy Policy</Link>
      </p>
    </footer>
  )
}
