import Link from 'next/link'
import { OPERATOR_NAME, contactLine } from '@/lib/legal'

// Site-wide footer — mounted ONCE in app/layout.tsx so the operator name and
// contact (lib/legal.ts) plus the Terms / Privacy links reach every page,
// public or signed-in. Pages must not mount it themselves (duplicate footers).
// pb-24 clears the fixed bottom tab bar.
export default function SiteFooter() {
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <p className="text-center font-dm-sans text-xs text-forest-green/80">
        <Link href="/terms" className="underline hover:text-forest-green">Terms</Link>
        {' · '}
        <Link href="/privacy" className="underline hover:text-forest-green">Privacy Policy</Link>
      </p>
      <p className="mt-2 text-center font-dm-sans text-xs text-forest-green/80">
        {OPERATOR_NAME} · {contactLine()}
      </p>
    </footer>
  )
}
