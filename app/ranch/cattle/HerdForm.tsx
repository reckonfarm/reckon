'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LOT_CLASSES,
  LOT_PURPOSES,
  LOT_PURPOSE_LABELS,
  type LotPurpose,
  LOT_CLASS_LABELS,
  LOT_FRAMES,
  LOT_NAME_MAX,
  DEFAULT_FRAME,
  lotLabel,
  type Lot,
  type LotClass,
  type LotFrame,
  type WeightUnit,
} from '@/lib/herd'
import { Card } from '@/app/components/ui/Card'
import { Button } from '@/app/components/ui/Button'
import { Field, Input, Select } from '@/app/components/ui/Field'
import { Segmented } from '@/app/components/ui/Segmented'
import Link from 'next/link'

// Capture-first herd entry. The fast path is class → head → weight (+ lb/cwt); those four
// make a valid lot, saved instantly. Frame / weaned / sale windows are pre-filled defaults
// behind "Sharpen details" — available, never blocking. Saves go ONE LOT AT A TIME to
// /api/herd/lots (Block 4B: rows, not a blob); the server's rows are adopted back into state.
// No dollars here — valuation lands with the MARS/HerdEstimate engine later.

const FEEDER_CLASSES: readonly LotClass[] = ['steers', 'heifers', 'yearlings']
const isFeeder = (c: LotClass) => FEEDER_CLASSES.includes(c)

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type Editing = 'new' | string | null

// What we PATCH. New lots omit id/timestamps (server stamps + generates id). Edits keep id +
// created_at and omit updated_at, so the server bumps only the edited lot's updated_at.
interface LotPayload {
  id?: string
  name?: string        // optional; the server trims, caps, and drops a blank one
  class: LotClass
  head_count: number
  avg_weight: number
  weight_unit: WeightUnit
  frame: LotFrame
  weaned: boolean
  sale_windows: { month: string }[]
  purpose?: LotPurpose
  created_at?: string
}

function formatMonth(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return ym
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ’${d.toLocaleDateString('en-US', { year: '2-digit' })}`
}

export default function HerdForm({ initialLots, lastWork = {}, purposeSupported = false }: { initialLots?: Lot[]; lastWork?: Record<string, { ts: string; bales: number | null; what?: string | null; head?: number | null; eventId: string }>; purposeSupported?: boolean } = {}) {
  const router = useRouter()
  const [lots, setLots] = useState<Lot[]>(initialLots ?? [])
  const [loading, setLoading] = useState(!initialLots)
  const [dPurpose, setDPurpose] = useState<LotPurpose | ''>('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')

  const [editing, setEditing] = useState<Editing>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Draft editor fields.
  const [dName, setDName] = useState('')
  const [dClass, setDClass] = useState<LotClass | ''>('')
  const [dHead, setDHead] = useState('')
  const [dWeight, setDWeight] = useState('')
  const [dUnit, setDUnit] = useState<WeightUnit>('lb')
  const [dFrame, setDFrame] = useState<LotFrame>(DEFAULT_FRAME)
  const [dWeaned, setDWeaned] = useState(true)
  const [dWindows, setDWindows] = useState<string[]>([])
  const [dMonth, setDMonth] = useState('')
  const [showDetail, setShowDetail] = useState(false)

  useEffect(() => {
    if (initialLots) return   // Block 6A: the page hands the rows in; writes reload from /api/herd/lots
    fetch('/api/operation-profile')
      .then(async r => {
        if (!r.ok) throw new Error('Could not load your herd. Refresh to try again.')
        return r.json()
      })
      .then((data: { profile?: { herd?: { lots?: Lot[] } } }) => {
        const loaded = data?.profile?.herd?.lots
        setLots(Array.isArray(loaded) ? loaded : [])
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [initialLots])

  function resetDraft() {
    setDName(''); setDClass(''); setDHead(''); setDWeight(''); setDUnit('lb')
    setDFrame(DEFAULT_FRAME); setDWeaned(true); setDWindows([]); setDMonth(''); setShowDetail(false); setDPurpose('')
  }

  function openAdd() { resetDraft(); setErrorMsg(''); setEditing('new') }

  function openEdit(lot: Lot) {
    setDName(lot.name ?? '')
    setDClass(lot.class)
    setDHead(String(lot.head_count))
    setDWeight(String(lot.avg_weight))
    setDUnit(lot.weight_unit)
    setDFrame(lot.frame)
    setDWeaned(lot.weaned)
    setDWindows(lot.sale_windows?.map(w => w.month) ?? [])
    setDPurpose(lot.purpose ?? '')
    setDMonth('')
    setShowDetail((lot.sale_windows?.length ?? 0) > 0)
    setErrorMsg(''); setEditing(lot.id)
  }

  function cancel() { setEditing(null); setErrorMsg(''); if (status === 'error') setStatus('idle') }

  const headNum = Number(dHead)
  const weightNum = Number(dWeight)
  const draftValid = dClass !== '' && /^\d+$/.test(dHead.trim()) && headNum > 0 && weightNum > 0

  function buildPayloadLot(): LotPayload {
    const lot: LotPayload = {
      name: dName.trim(),
      class: dClass as LotClass,
      head_count: headNum,
      avg_weight: weightNum,
      weight_unit: dUnit,
      frame: dFrame,
      weaned: dWeaned,
      sale_windows: dWindows.map(month => ({ month })),
      ...(purposeSupported && dPurpose ? { purpose: dPurpose } : {}),
    }
    if (editing && editing !== 'new') {
      lot.id = editing
      const orig = lots.find(l => l.id === editing)
      if (orig) lot.created_at = orig.created_at
    }
    return lot
  }

  // Block 4B — lots are rows: each save touches ONE lot (POST new, PATCH by id with the
  // updated_at this form last saw; DELETE retires). Two people editing different lots
  // never overwrite each other; a same-lot edit that lost the race comes back 409 and the
  // form reloads the other person's version instead of writing over it.
  async function reload(): Promise<Lot[]> {
    const res = await fetch('/api/herd/lots')
    const json = await res.json().catch(() => ({}))
    const next = Array.isArray((json as { lots?: Lot[] }).lots) ? (json as { lots: Lot[] }).lots : []
    setLots(next)
    return next
  }
  async function write(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
    setStatus('saving'); setErrorMsg('')
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setErrorMsg((json as { error?: string }).error ?? 'Could not save. Try again.')
        if (res.status === 409 || res.status === 404) await reload()   // show the ranch's current version, never write over it
        return false
      }
      await reload()
      router.refresh()   // the server-computed HerdEstimate above re-reads the rows
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 2000)
      return true
    } catch {
      setStatus('error')
      setErrorMsg('Could not reach the server. Check your connection and try again.')
      return false
    }
  }

  async function saveDraft() {
    if (!draftValid) return
    const lot = buildPayloadLot()
    const ok = editing === 'new'
      ? await write('/api/herd/lots', 'POST', lot)
      : await write(`/api/herd/lots/${editing}`, 'PATCH', { ...lot, expected_updated_at: lots.find(l => l.id === editing)?.updated_at ?? null })
    if (ok) { setEditing(null); resetDraft() }
  }

  async function removeLot(id: string) {
    if (await write(`/api/herd/lots/${id}`, 'DELETE') && editing === id) setEditing(null)
  }

  function addWindow() {
    if (!/^\d{4}-\d{2}$/.test(dMonth)) return
    setDWindows(w => (w.includes(dMonth) ? w : [...w, dMonth].sort()))
    setDMonth('')
  }

  // ── Editor (shared by add + edit) ───────────────────────────────────────────────
  function renderEditor() {
    return (
      <Card shadow="soft" className="p-4 sm:p-5">
        <p className="font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">
          {editing === 'new' ? 'Add a lot' : 'Edit lot'}
        </p>

        <div className="mt-3">
          <p className="mb-1.5 font-dm-sans text-[16px] font-medium text-ink">Class</p>
          <div role="group" aria-label="Class" className="flex flex-wrap gap-2">
            {LOT_CLASSES.map(c => {
              const on = dClass === c
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDClass(c)}
                  className={[
                    'min-h-[48px] rounded-lg border px-3 font-dm-sans text-[16px] transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    on ? 'border-accent bg-accent font-semibold text-cream' : 'border-line/20 text-accent hover:bg-accent/5',
                  ].join(' ')}
                >
                  {LOT_CLASS_LABELS[c]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-4">
          <Field label="Name" hint="Optional — what you call this bunch. Left blank, the lot goes by its class.">
            <Input
              value={dName}
              maxLength={LOT_NAME_MAX}
              placeholder="Optional — e.g. Replacement heifers"
              onChange={e => setDName(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {purposeSupported && (
            <Field label="Purpose" hint="What this bunch is for. A market comparison states its basis from this.">
              <Select value={dPurpose} onChange={e => setDPurpose(e.target.value as LotPurpose | '')} data-audit="lot-purpose">
                <option value="">Not set</option>
                {LOT_PURPOSES.map(v => <option key={v} value={v}>{LOT_PURPOSE_LABELS[v]}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Head count">
            <Input
              type="number" inputMode="numeric" min={1} step={1} placeholder="e.g. 120"
              value={dHead} onChange={e => setDHead(e.target.value)}
            />
          </Field>
          <div>
            <Field label="Average weight">
              <Input
                type="number" inputMode="decimal" min={0} step="any"
                placeholder={dUnit === 'cwt' ? 'e.g. 5.5' : 'e.g. 550'}
                value={dWeight} onChange={e => setDWeight(e.target.value)}
              />
            </Field>
            <div className="mt-2">
              <Segmented<WeightUnit>
                ariaLabel="Weight unit"
                value={dUnit}
                onChange={setDUnit}
                options={[{ value: 'lb', label: 'lb' }, { value: 'cwt', label: 'cwt' }]}
              />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowDetail(s => !s)}
            className="font-dm-sans text-[16px] font-medium text-brand hover:text-accent"
          >
            {showDetail ? 'Hide details' : 'Sharpen details (optional)'}
          </button>

          {showDetail && (
            <div className="mt-3 space-y-4 border-t border-line/10 pt-4">
              <Field label="Frame" hint="USDA frame size — most lots are Medium and Large.">
                <Select value={dFrame} onChange={e => setDFrame(e.target.value as LotFrame)}>
                  {LOT_FRAMES.map(f => <option key={f} value={f}>{f}</option>)}
                </Select>
              </Field>

              {dClass !== '' && isFeeder(dClass) && (
                <div>
                  <p className="mb-1.5 font-dm-sans text-[16px] font-medium text-ink">Weaned</p>
                  <Segmented<'weaned' | 'unweaned'>
                    ariaLabel="Weaned"
                    value={dWeaned ? 'weaned' : 'unweaned'}
                    onChange={v => setDWeaned(v === 'weaned')}
                    options={[{ value: 'weaned', label: 'Weaned' }, { value: 'unweaned', label: 'Unweaned' }]}
                  />
                </div>
              )}

              <div>
                <p className="mb-1.5 font-dm-sans text-[16px] font-medium text-ink">Sale windows</p>
                <p className="mb-2 font-dm-sans text-[14px] text-secondary-ink">
                  When you expect to sell. Leave empty if you&rsquo;re not sure yet.
                </p>
                {dWindows.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {dWindows.map(m => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1 rounded-full border border-line/20 bg-accent/[0.05] px-2.5 py-1 font-dm-sans text-[14px] text-accent"
                      >
                        {formatMonth(m)}
                        <button
                          type="button"
                          aria-label={`Remove ${formatMonth(m)}`}
                          onClick={() => setDWindows(w => w.filter(x => x !== m))}
                          className="text-secondary-ink hover:text-warning"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input type="month" value={dMonth} onChange={e => setDMonth(e.target.value)} className="flex-1" />
                  <Button variant="secondary" onClick={addWindow} className="shrink-0">Add</Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {errorMsg && <p className="mt-3 font-dm-sans text-[16px] font-medium text-warning">{errorMsg}</p>}

        <div className="mt-4 flex items-center gap-4">
          <Button variant="primary" onClick={saveDraft} disabled={!draftValid || status === 'saving'}>
            {status === 'saving' ? 'Saving…' : editing === 'new' ? 'Add lot' : 'Save changes'}
          </Button>
          <button type="button" onClick={cancel} className="font-dm-sans text-[16px] text-secondary-ink hover:text-ink">
            Cancel
          </button>
        </div>
      </Card>
    )
  }

  function renderRow(lot: Lot) {
    const work = lastWork[lot.id]
    const menuOpen = menuFor === lot.id
    return (
      <Card key={lot.id} shadow="sm" className="p-4" data-audit="lot-row">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-dm-sans text-[17px] font-semibold text-ink">
              <span className="tabular-nums" data-audit="lot-head">{lot.head_count.toLocaleString('en-US')}</span> head · {lotLabel(lot)}
            </p>
            <p className="mt-0.5 font-dm-sans text-[16px] text-ink">
              {lot.name?.trim() ? `${LOT_CLASS_LABELS[lot.class]} · ` : ''}
              {lot.purpose ? <span data-audit="lot-purpose-label">{LOT_PURPOSE_LABELS[lot.purpose]} · </span> : null}
              <span className="tabular-nums">{lot.avg_weight}</span> {lot.weight_unit} avg
              {isFeeder(lot.class) ? ` · ${lot.weaned ? 'weaned' : 'unweaned'}` : ''}
            </p>
            {work && (
              <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="lot-last-work">
                Last recorded work: <Link href={`/ranch/activity/${work.eventId}`} className="underline underline-offset-2">{work.what ? `${work.what}${work.head != null ? ` ${work.head.toLocaleString('en-US')} head` : ''}` : work.bales != null ? `fed ${work.bales} ${work.bales === 1 ? 'bale' : 'bales'}` : 'fed hay'} · {new Date(work.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' })}</Link>
              </p>
            )}
            <p className="mt-1">
              <Link href={`/markets?lot=${lot.id}`} className="inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="lot-market-link">View market comparison →</Link>
            </p>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => openEdit(lot)} className="inline-flex min-h-[44px] items-center px-2 font-dm-sans text-[16px] font-medium text-accent hover:text-brand">
              Edit
            </button>
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`More for ${lotLabel(lot)}`} onClick={() => setMenuFor(menuOpen ? null : lot.id)} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 font-dm-sans text-[20px] leading-none text-secondary-ink hover:text-ink" data-audit="lot-more">
              ···
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-72 rounded-lg border border-control-border bg-surface p-3 shadow-lg" data-audit="lot-menu">
                <p className="font-dm-sans text-[15px] text-secondary-ink">Archive this lot? History stays; the lot leaves current views.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" role="menuitem" onClick={() => { setMenuFor(null); void removeLot(lot.id) }} disabled={status === 'saving'} className="inline-flex min-h-[44px] items-center rounded-lg bg-forest-green px-4 font-dm-sans text-[16px] font-semibold text-cream disabled:opacity-50" data-audit="lot-archive">Archive</button>
                  <button type="button" role="menuitem" onClick={() => setMenuFor(null)} className="inline-flex min-h-[44px] items-center px-3 font-dm-sans text-[16px] font-semibold text-ink">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    )
  }
  // ── Render ──────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mt-8 space-y-3">
        {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-accent/[0.06]" />)}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mt-8">
        <Card shadow="none" className="border-warning/30 bg-warning/[0.06] px-4 py-3">
          <p className="font-dm-sans text-[16px] text-warning">{loadError}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="mt-8 space-y-4">
      {status === 'saved' && (
        <p className="font-dm-sans text-[16px] font-medium text-up">Saved ✓</p>
      )}

      {lots.length === 0 && editing !== 'new' && (
        <Card shadow="soft" className="px-6 py-10 text-center">
          <p className="font-fraunces text-xl font-semibold text-ink">Add your first lot</p>
          <p className="mx-auto mt-2 max-w-sm font-dm-sans text-[16px] text-secondary-ink">
            Tell us what you&rsquo;re running — a class, a head count, an average weight. A few
            seconds a lot, and you can sharpen the details later.
          </p>
          <div className="mt-5">
            <Button variant="primary" onClick={openAdd}>Add a lot</Button>
          </div>
        </Card>
      )}

      {lots.length > 0 && (
        <div className="space-y-3">
          {lots.map(lot => (editing === lot.id ? <div key={lot.id}>{renderEditor()}</div> : renderRow(lot)))}
        </div>
      )}

      {editing === 'new' && renderEditor()}

      {editing === null && lots.length > 0 && (
        <Button variant="secondary" onClick={openAdd}>Add another lot</Button>
      )}
    </div>
  )
}
