'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { RanchView as View } from '@/lib/ranch-view'
import { fmtDay } from '@/lib/jobs/format'

// ─── The Ranch view (Block 47) ───────────────────────────────────────────────
// One page, read at a glance. Three numbers at the top — head, bales on hand
// with days of feed left, rain this season against normal — each a tap that
// opens the arithmetic and the records beneath it, and closes on a second
// tap. Under them three tabs: Cattle, Ground, The record — the same page, no
// navigation. A number without a record behind it is not painted.

type Tab = 'cattle' | 'ground' | 'record'
const ranchDay = (key: string) => fmtDay(`${key}T12:00:00-06:00`)
const n = (v: number) => v.toLocaleString('en-US')
const inches = (v: number) => `${v.toFixed(2)}"`

export default function RanchView({ view, todayCount, cattle, ground, record }: { view: View; todayCount: number; cattle: ReactNode; ground: ReactNode; record: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('cattle')
  const toggle = (k: string) => setOpen(o => (o === k ? null : k))

  const numbers: { key: string; value: string; word: string; under: ReactNode }[] = []
  if (view.head) numbers.push({
    key: 'head', value: n(view.head.total), word: 'head',
    under: (
      <>
        <ul className="divide-y divide-forest-green/10" data-audit="head-by-class">
          {view.head.byClass.map(c => <li key={c.label} className="flex justify-between py-1.5 font-dm-sans text-[16px] text-ink"><span>{c.label} · {c.bunches} {c.bunches === 1 ? 'bunch' : 'bunches'}</span><span className="tabular-nums">{n(c.head)}</span></li>)}
        </ul>
        <p className="mt-2 font-dm-sans text-[15px] text-ink">{view.head.bunches} {view.head.bunches === 1 ? 'bunch' : 'bunches'} · <button type="button" onClick={() => setTab('cattle')} className="font-semibold text-brand underline underline-offset-2">Cattle</button></p>
      </>
    ),
  })
  if (view.hay) {
    const h = view.hay
    const daysWord = h.daysLeft != null ? `${n(h.daysLeft)} days left` : h.withheld === 'thin_feeding' || h.withheld === 'no_recent_feeding' ? 'not enough feeding recorded' : h.withheld === 'nothing_left' ? 'nothing left' : null
    numbers.push({
      key: 'hay', value: n(h.onHand), word: `bales on hand${daysWord ? ` · ${daysWord}` : ''}`,
      under: (
        <>
          <p className="font-dm-sans text-[16px] text-ink" data-audit="hay-arithmetic">{n(h.countedBales)} counted {ranchDay(h.baselineAsOf)} + {n(h.stackedSince)} added − {n(h.fedSince)} fed = {n(h.onHand)} on hand</p>
          {h.daysLeft != null && h.rate
            ? <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="hay-rate">{n(h.onHand)} ÷ {h.rate.balesPerDay >= 10 ? Math.round(h.rate.balesPerDay) : h.rate.balesPerDay.toFixed(1)} bales/day = {n(h.daysLeft)} days · the rate is {n(h.rate.bales)} bales over the last {h.rate.windowDays} days (fed on {h.rate.daysWithEntries} of them)</p>
            : <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="hay-rate">{h.withheld === 'nothing_left' ? 'The stack is at zero.' : 'Not enough feeding recorded to give a rate — no days left is said, not guessed.'}</p>}
          {h.fedThisSeason && <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="hay-season">Feed used this season: {n(h.fedThisSeason.bales)} bales · {h.fedThisSeason.entries} feedings over {h.fedThisSeason.days} days</p>}
          <p className="mt-2 font-dm-sans text-[15px]"><Link href="/ranch/activity?lot=" className="inline-flex min-h-[48px] items-center font-semibold text-brand underline underline-offset-2">Every hay line</Link></p>
        </>
      ),
    })
  }
  if (view.rain) {
    const r = view.rain
    const diff = r.normal != null ? r.recorded - r.normal : null
    numbers.push({
      key: 'rain', value: inches(r.recorded), word: `rain this season${r.normal != null ? ` · ${inches(r.normal)} normal` : ''}`,
      under: (
        <>
          <p className="font-dm-sans text-[16px] text-ink" data-audit="rain-arithmetic">{r.entries} {r.entries === 1 ? 'reading' : 'readings'} on {r.places} {r.places === 1 ? 'place' : 'places'} since Jan 1, {r.year}, added up.</p>
          {r.normal != null && diff != null && <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="rain-normal">{inches(r.recorded)} − {inches(r.normal)} normal to date = {diff >= 0 ? '+' : '−'}{inches(Math.abs(diff))} · normal from {r.normalSource}</p>}
          <p className="mt-2 font-dm-sans text-[15px]"><Link href="/weather" className="inline-flex min-h-[48px] items-center font-semibold text-brand underline underline-offset-2">Rain on my places</Link></p>
        </>
      ),
    })
  }

  return (
    <div data-audit="ranch-view">
      <div className="mt-2 divide-y divide-forest-green/10 rounded-xl border border-forest-green/10 bg-white" data-audit="ranch-numbers">
        {numbers.map(x => (
          <section key={x.key} data-audit={`ranch-number-${x.key}`} data-open={open === x.key ? 'true' : 'false'}>
            <button type="button" onClick={() => toggle(x.key)} aria-expanded={open === x.key} className="flex min-h-[72px] w-full items-baseline gap-3 px-4 py-3 text-left" data-audit={`ranch-number-${x.key}-open`}>
              <span className="type-main-number text-ink" data-audit={`ranch-number-${x.key}-value`}>{x.value}</span>
              <span className="font-dm-sans text-[17px] text-ink" data-audit={`ranch-number-${x.key}-word`}>{x.word}</span>
            </button>
            {open === x.key && <div className="px-4 pb-4" data-audit={`ranch-number-${x.key}-under`}>{x.under}</div>}
          </section>
        ))}
        {numbers.length === 0 && <p className="px-4 py-4 font-dm-sans text-[17px] text-ink" data-audit="ranch-numbers-none">Nothing counted yet.</p>}
      </div>

      <div role="tablist" aria-label="Ranch" className="mt-4 flex gap-1 rounded-xl border border-forest-green/10 bg-white p-1" data-audit="ranch-tabs">
        {([['cattle', 'Cattle', null], ['ground', 'Ground', null], ['record', 'The record', todayCount]] as const).map(([k, word, count]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-[48px] flex-1 rounded-lg px-2 font-dm-sans text-[16px] font-semibold ${tab === k ? 'bg-forest-green text-white' : 'text-forest-green'}`}
            data-audit="ranch-tile" data-tile={k}>
            {word}{count != null && count > 0 && <span className="ml-1 font-normal" data-audit="tile-number">{count} today</span>}
          </button>
        ))}
      </div>
      <div className="mt-3" role="tabpanel" data-audit={`ranch-tab-${tab}`}>
        {tab === 'cattle' && cattle}
        {tab === 'ground' && ground}
        {tab === 'record' && record}
      </div>
    </div>
  )
}
