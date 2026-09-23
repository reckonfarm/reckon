import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { getRanchLots } from '@/lib/herd-lots'
import { privateTitle } from '@/lib/private-title'
import TallyScreen from './TallyScreen'
import LedgerStamp from '@/app/components/LedgerStamp'
import { ledgerThrough } from '@/lib/ledger-through'

export async function generateMetadata(): Promise<Metadata> { return privateTitle('Count at a gate') }

// Block 22 — the tally is its own screen, not a sheet: the whole page belongs
// to the number and the four buttons, and nothing scrolls under a thumb.
export default async function TallyPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Block 32: what this render read (the book count it counts against), taken first.
  const through = user ? await ledgerThrough(supabase) : null
  const lots = user ? await getRanchLots(supabase, user.id).catch(() => []) : []
  const { lot } = await searchParams
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {user && <LedgerStamp through={through} />}
      <h1 className="font-fraunces text-[28px] font-semibold text-ink">Count at a gate</h1>
      <TallyScreen lots={lots} initialLotId={typeof lot === 'string' && lot ? lot : null} />
    </main>
  )
}
