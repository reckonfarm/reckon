import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Hay Network',
  description:
    'Drought-aware hay listings for ranchers. Find hay near your county or post what you have. Buyers and sellers connect directly.',
}

export default function HayLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
