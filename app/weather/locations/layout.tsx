import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Counties',
  description:
    'Track drought status and LFP eligibility across your watched counties. Get alerted when a tier triggers.',
}

export default function WatchlistLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
