'use client'

import { useState } from 'react'
import { Heading } from '@/app/components/ui/Heading'
import { Segmented } from '@/app/components/ui/Segmented'
import { Field, Input, Select } from '@/app/components/ui/Field'

// TEMPORARY — design-system preview for the herd Zestimate / Markets sprint. Renders the
// new tokens + primitives in isolation so PK can verify the feel on-device before anything
// is refactored onto them. NOT linked from anywhere. DELETE this route after sign-off.

const EYEBROW = 'font-dm-sans text-xs font-medium uppercase tracking-wider text-muted/50'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line/10 bg-surface shadow-card p-5 sm:p-6">
      <p className={`${EYEBROW} mb-4`}>{title}</p>
      {children}
    </section>
  )
}

export default function DesignPreviewPage() {
  const [panel, setPanel] = useState<'now' | 'trend' | 'outlook'>('now')
  const [view, setView] = useState<'news' | 'weather' | 'hay' | 'markets'>('markets')
  const [season, setSeason] = useState<'spring' | 'fall'>('fall')

  const [head, setHead] = useState('120')
  const [weightClass, setWeightClass] = useState('m-l-1')
  const [kind, setKind] = useState('steers')
  const [sale, setSale] = useState('oct')
  const [badHead, setBadHead] = useState('99999')

  return (
    <main className="min-h-screen bg-cream">
      <div className="mx-auto max-w-md px-4 py-8 space-y-5">
        <div className="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2">
          <p className="font-dm-sans text-xs text-warning">
            Temporary preview · /design-preview · remove after sign-off
          </p>
        </div>

        <div>
          <Heading level={2}>Design system</Heading>
          <p className="mt-1 font-dm-sans text-sm text-muted/70">
            Fraunces warmth, data restraint. One bold number; everything else quiet.
          </p>
        </div>

        {/* ── Signature: the Zestimate hero — the single bold surface ───────────── */}
        <Section title="Herd value · the one bold number">
          <p className="font-dm-sans text-sm text-muted/60">Estimated herd value</p>
          <p className="mt-1 font-fraunces text-5xl font-semibold tracking-tight text-ink tabular-nums sm:text-6xl">
            $184,200
          </p>
          <p className="mt-2 font-dm-sans text-sm font-medium text-up tabular-price">
            ▲ $6,410 · 3.6% this week
          </p>
          <p className="mt-3 font-dm-sans text-xs text-muted/50">
            120 head · est. at this week&rsquo;s Billings cash. Estimate, not an offer.
          </p>
        </Section>

        {/* ── Segmented control — three real shapes, all interactive ───────────── */}
        <Section title="Segmented control">
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 font-dm-sans text-xs text-muted/50">Now / Trend / Outlook (the new markets toggle)</p>
              <Segmented
                ariaLabel="Markets panel"
                value={panel}
                onChange={setPanel}
                options={[
                  { value: 'now', label: 'Now' },
                  { value: 'trend', label: 'Trend' },
                  { value: 'outlook', label: 'Outlook' },
                ]}
              />
            </div>

            <div>
              <p className="mb-1.5 font-dm-sans text-xs text-muted/50">Dashboard view switch (4 segments)</p>
              <Segmented
                ariaLabel="Dashboard view"
                value={view}
                onChange={setView}
                options={[
                  { value: 'news', label: 'News' },
                  { value: 'weather', label: 'Weather' },
                  { value: 'hay', label: 'Hay' },
                  { value: 'markets', label: 'Markets' },
                ]}
              />
            </div>

            <div>
              <p className="mb-1.5 font-dm-sans text-xs text-muted/50">Two segments</p>
              <Segmented
                ariaLabel="Grazing season"
                value={season}
                onChange={setSeason}
                options={[
                  { value: 'spring', label: 'Spring run' },
                  { value: 'fall', label: 'Fall run' },
                ]}
              />
            </div>
          </div>
        </Section>

        {/* ── Form primitives — a mock "add a herd lot" row ────────────────────── */}
        <Section title="Form — add a herd lot">
          <div className="space-y-4">
            <Field label="Head count" hint="How many head in this lot.">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={head}
                onChange={e => setHead(e.target.value)}
              />
            </Field>

            <Field label="Weight class">
              <Select value={weightClass} onChange={e => setWeightClass(e.target.value)}>
                <option value="m-l-1">Medium &amp; Large 1</option>
                <option value="m-l-2">Medium &amp; Large 2</option>
                <option value="s-1">Small 1</option>
              </Select>
            </Field>

            <Field label="Class">
              <Select value={kind} onChange={e => setKind(e.target.value)}>
                <option value="steers">Steers</option>
                <option value="heifers">Heifers</option>
                <option value="cows">Cows</option>
                <option value="bulls">Bulls</option>
              </Select>
            </Field>

            <Field label="Sale window" hint="When you expect to sell this lot.">
              <Select value={sale} onChange={e => setSale(e.target.value)}>
                <option value="now">Sell now</option>
                <option value="oct">October &rsquo;26</option>
                <option value="jan">January &rsquo;27</option>
                <option value="apr">April &rsquo;27</option>
              </Select>
            </Field>

            <Field label="Head count" required error="Enter a number between 1 and 5,000.">
              <Input
                type="number"
                inputMode="numeric"
                value={badHead}
                onChange={e => setBadHead(e.target.value)}
              />
            </Field>
          </div>
        </Section>

        {/* ── Tabular price treatment — DM Sans tabular, right-aligned ─────────── */}
        <Section title="Dense price figures · tabular-price">
          <div className="font-dm-sans text-sm">
            {[
              { m: 'Sell now', cwt: '262.40' },
              { m: 'October ’26', cwt: '258.15' },
              { m: 'January ’27', cwt: '249.80' },
              { m: 'April ’27', cwt: '241.05' },
            ].map(r => (
              <div key={r.m} className="flex items-center justify-between border-b border-line/10 py-2 last:border-0">
                <span className="text-muted/70">{r.m}</span>
                <span className="tabular-price text-ink">${r.cwt}/cwt</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Tokens — direction + elevation ───────────────────────────────────── */}
        <Section title="Tokens">
          <div className="space-y-4">
            <div className="flex items-center gap-6">
              <span className="font-dm-sans text-sm font-medium text-up tabular-price">▲ up · $6,410</span>
              <span className="font-dm-sans text-sm font-medium text-down tabular-price">▼ down · $2,180</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {([
                ['up', 'bg-up'],
                ['down', 'bg-down'],
                ['accent', 'bg-accent'],
                ['ink', 'bg-ink'],
                ['surface', 'bg-surface border border-line/15'],
              ] as const).map(([name, cls]) => (
                <div key={name} className="flex flex-col items-center gap-1">
                  <span className={`h-10 w-10 rounded-lg ${cls}`} />
                  <span className="font-dm-sans text-[11px] text-muted/60">{name}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <div className="flex-1 rounded-xl bg-surface shadow-card p-3 text-center font-dm-sans text-xs text-muted/60">
                shadow-card
              </div>
              <div className="flex-1 rounded-xl bg-surface shadow-pop p-3 text-center font-dm-sans text-xs text-muted/60">
                shadow-pop
              </div>
            </div>
          </div>
        </Section>
      </div>
    </main>
  )
}
