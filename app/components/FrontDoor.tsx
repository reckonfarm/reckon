import Link from 'next/link'
import Image from 'next/image'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { BARN_GEO } from '@/lib/barn-geo'
import { scopeLabel } from '@/lib/market-scope'

// ─── Front door — the signed-out homepage (Block 2.5, Part C) ─────────────────
// Dryline is a private ranch ledger. The page leads with the ledger, shows a
// real screen of it, and asks for a pilot — not a purchase (billing is not
// live, hay accounting is not built). Every line below describes behavior
// that ships today: feed logging, repeat-last, offline save states, place
// history, since-you-were-here. The county drought / program / weather /
// market tools keep a plain-text door and a small honest Markets module; they
// are not the hero.
//
// The screenshot is a real capture of the production ledger, taken on a
// named fictional ranch ("Dry Creek Ranch") — never a mockup, never a real
// operation's data. Every server read degrades to nothing and never throws.

async function latestLocalReference(): Promise<{ scope: string; town: string; saleDate: string; reportId: string } | null> {
  try {
    const db = createServiceClient()
    const { data } = await db.from('mars_price_snapshots').select('slug_id, report_date').order('report_date', { ascending: false }).limit(1).maybeSingle()
    if (!data) return null
    const town = BARN_GEO[data.slug_id as string]?.town.replace(/,\s*[A-Z]{2}$/, '') ?? 'Montana'
    return { scope: scopeLabel({ kind: 'nearby', town }), town, saleDate: data.report_date as string, reportId: data.slug_id as string }
  } catch {
    return null
  }
}

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default async function FrontDoor() {
  const ref = await latestLocalReference()

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-cream">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:py-20">

          {/* ── 1. Mark + the one line ─────────────────────────────────────── */}
          <section className="text-center">
            <p className="font-fraunces text-[17px] font-medium tracking-tight text-forest-green">Your ranch, on the record.</p>

            {/* ── 2. Headline · 3. Subhead — only what ships ─────────────────── */}
            <h1 className="mt-4 font-fraunces text-[40px] font-semibold leading-[1.08] tracking-tight text-ink sm:text-[52px]">
              Know what got fed.<br />Know what&rsquo;s on hand.
            </h1>
            <p className="mx-auto mt-5 max-w-xl font-dm-sans text-[17px] leading-relaxed text-forest-green/80 sm:text-[18px]">
              A shared feeding record for your ranch. Log the feed from your phone, see what&rsquo;s left,
              and leave the next person a clear handoff. Works with no signal and no hardware.
            </p>
          </section>

          {/* ── 4. One real screen — the answer line and the save states ───── */}
          <section className="mt-10">
            <Card shadow="soft" className="overflow-hidden p-0">
              <Image
                src="/landing/ledger-answer.png"
                alt="The Dryline ledger after a feeding is logged: the entry reads Synced to ranch, then the answer — 4 bales recorded, 196 bales on hand from the last count, 4 fed since."
                width={732}
                height={475}
                priority
                className="h-auto w-full"
              />
            </Card>
            <p className="mt-2 text-center font-dm-sans text-[13px] text-forest-green/80">
              A real screen from the ledger, on an example ranch (Dry Creek Ranch). Saved on this phone → Waiting to sync → Synced to ranch, then the answer.
            </p>
          </section>

          {/* ── 5. The one ask · C3 who / what / cost ───────────────────────── */}
          <section className="mt-10">
            <Card shadow="soft" className="p-6 sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="sm:max-w-sm">
                  <Link
                    href="/signin?mode=signup&pilot=winter"
                    className="inline-flex min-h-[56px] w-full items-center justify-center rounded-lg bg-forest-green px-6 font-dm-sans text-[17px] font-semibold text-cream transition-colors hover:bg-forest-green/90 sm:w-auto"
                  >
                    Join the winter pilot
                  </Link>
                  <p className="mt-3 font-dm-sans text-[15px] leading-relaxed text-forest-green/80">
                    Billing isn&rsquo;t live yet, so the honest ask is a pilot, not a purchase. Pricing will be per ranch, not per head.
                  </p>
                </div>
                <ul className="space-y-3 font-dm-sans text-[15px] leading-relaxed text-forest-green sm:max-w-xs">
                  <li><span className="font-semibold">Who it&rsquo;s for.</span> Cow-calf and hay operations with more than one person doing chores.</li>
                  <li><span className="font-semibold">What works today, no hardware.</span> Feed, hay, rain, cattle moved and worked — logged in two taps, saved on the phone first, synced when there&rsquo;s signal. Repeat yesterday&rsquo;s feeding. See what changed since you last checked. Every place keeps its own memory.</li>
                  <li><span className="font-semibold">What isn&rsquo;t built yet.</span> Hay accounting beyond bales fed and on hand, and billing.</li>
                </ul>
              </div>
            </Card>
          </section>

          {/* ── 6. The county tools keep a door; Markets keeps an honest module ── */}
          <section className="mt-10 text-center">
            <p className="font-dm-sans text-[15px] text-forest-green/80">
              <Link href="/dashboard" className="min-h-[44px] font-semibold text-forest-green underline underline-offset-2">Check county drought, programs, and markets</Link>
              {' '}— free, no account needed.
            </p>
          </section>

          {ref && (
            <section className="mt-8">
              <Card shadow="none" className="px-5 py-4">
                <p className="font-dm-sans text-[13px] font-semibold uppercase tracking-wider text-forest-green/80">Markets · latest reference</p>
                <p className="mt-1 font-dm-sans text-[16px] text-forest-green">
                  {ref.scope} · sale of {fmtDate(ref.saleDate)} · USDA AMS report {ref.reportId}
                </p>
                <p className="mt-1 font-dm-sans text-[14px] text-forest-green/80">
                  An auction report from {ref.town}, with head counts and class on every line. Not a county price, not a forecast.{' '}
                  <Link href="/dashboard?fips=30111&view=markets" className="font-semibold text-forest-green underline underline-offset-2">Open Markets →</Link>
                </p>
              </Card>
            </section>
          )}
        </div>
      </main>
    </>
  )
}
