import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { privateTitle } from '@/lib/private-title'
import SiteHeader from '@/app/components/SiteHeader'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { Card } from '@/app/components/ui/Card'
import { listTrash, TRASH_DAYS } from '@/lib/trash'
import TrashList from './TrashList'

// ─── /account/trash (Block 12, 12.4) ──────────────────────────────────────────
// Where deleted things wait for seven days. PK's ruling: he never sees it
// unless he goes looking — so it hangs off Account, is linked from nowhere
// else, and nothing in the app nags about it. Restore is here; the purge is a
// cron and no button.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Trash')

export default async function TrashPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/account/trash')
  const items = await listTrash(supabase)

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Account</p>
        <h1 className="mt-1 type-page-heading text-ink">Trash</h1>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">
          Deleted things wait here {TRASH_DAYS} days, then they are gone for good. Restore puts one back exactly where it was.
        </p>

        <Card className="mt-4 p-0">
          {items.length === 0 ? (
            <p className="px-4 py-5 font-dm-sans text-[17px] text-ink" data-audit="trash-empty">Nothing in the trash.</p>
          ) : (
            <TrashList items={items} />
          )}
        </Card>

        <p className="mt-4 font-dm-sans text-[16px] text-secondary-ink">
          A restored working puts its head counts back too, once that part is built — until then, check the bunch after restoring one.{' '}
          <Link href="/account" className="font-semibold text-brand underline underline-offset-2">Back to Account</Link>
        </p>
      </main>
    </>
  )
}
