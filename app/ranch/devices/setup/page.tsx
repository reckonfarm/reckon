import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { privateTitle } from '@/lib/private-title'
import { CONTACT_EMAIL } from '@/lib/legal'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// ─── /ranch/devices/setup (Block 6A) ──────────────────────────────────────────
// One paragraph: how a device gets its readings to the ranch's record. The
// hardware line is on hold; this exists so "Set up a device" never leads to
// a dead button. It says what is true today and nothing that is not.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Set up a device')

export default async function DeviceSetupPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch/devices/setup')
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch · Devices</p>
        <h1 className="mt-1 type-page-heading text-ink">Set up a device</h1>
        <Card className="mt-4 p-5">
          <p className="font-dm-sans text-[17px] leading-relaxed text-ink" data-audit="setup-paragraph">
            A Dryline device is a small logger that records on its own and hands its readings to a phone that passes by — the courier. A Scout rides a machine and records its work; a Spotter sits at a gauge and records rain; a Sentinel serves a fixed spot such as a tank. Nothing here needs a signal in the field: the device stores its readings, the phone collects them over Bluetooth when it comes within range, and the readings reach the ranch&rsquo;s record the next time that phone has service. Each device is tied to a place or a machine when it is registered, so its readings land where the work happened. Devices are registered by Dryline for now; to get one on your place, write to <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-brand underline underline-offset-2">{CONTACT_EMAIL}</a>. You can record work by hand in the meantime; nothing waits on hardware.
          </p>
        </Card>
        <p className="mt-4"><Link href="/ranch/devices" className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">Back to Devices</Link></p>
      </main>
    </>
  )
}
