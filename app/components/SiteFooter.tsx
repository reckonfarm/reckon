'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { OPERATOR_NAME, CONTACT_EMAIL, MAILING_ADDRESS } from '@/lib/legal'

// ─── Footer (Block 6B) — compact everywhere; the long address only on legal pages ──
export default function SiteFooter() {
  const pathname = usePathname()
  const legal = pathname === '/terms' || pathname === '/privacy'
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6" data-audit="site-footer">
      <p className="font-dm-sans text-[14px] text-secondary-ink">
        <Link href="/terms" className="underline hover:text-forest-green">Terms</Link>
        {' · '}
        <Link href="/privacy" className="underline hover:text-forest-green">Privacy Policy</Link>
      </p>
      <p className="mt-1 font-dm-sans text-[14px] text-secondary-ink">
        {OPERATOR_NAME}{CONTACT_EMAIL ? ` · ${CONTACT_EMAIL}` : ''}
        {legal && <span className="block" data-audit="footer-address">{MAILING_ADDRESS}</span>}
      </p>
    </footer>
  )
}
