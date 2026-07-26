import { notFound } from 'next/navigation'
import { flagDisabled } from '@/lib/flags'

// Messaging flagged off → /messages 404s from this server layout (the page
// itself is a client component, so the gate lives here — mirrors app/hay/layout.tsx).
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  if (flagDisabled('messaging')) notFound()
  return <>{children}</>
}
