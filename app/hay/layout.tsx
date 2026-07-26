import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { flagDisabled } from '@/lib/flags'

export const metadata: Metadata = {
  title: 'Hay Network',
  description:
    'Drought-aware hay listings for ranchers. Find hay near your county or post what you have. Buyers and sellers connect directly.',
}

export default function HayLayout({ children }: { children: React.ReactNode }) {
  // Marketplace flagged off → every /hay/* segment 404s from this one server
  // layout (the list page below is a client component, so the gate lives here).
  if (flagDisabled('marketplace')) notFound()
  return <>{children}</>
}
