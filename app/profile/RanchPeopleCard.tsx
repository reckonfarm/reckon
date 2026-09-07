'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { Field, Input, Select } from '@/app/components/ui/Field'
import { Button } from '@/app/components/ui/Button'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// ─── People on this ranch (Phase A2) ─────────────────────────────────────────
// Members with their role; open invitations with who sent them and when they
// expire; and, for an owner, "Add someone to this ranch". Every write goes to a
// service-role route that re-checks the owner from the session — nothing here
// touches ranch_members directly. Removal says plainly what the person loses.

type Role = 'owner' | 'member'
type Person = { user_id: string; email: string | null; name: string | null; role: Role; since: string }
type Invite = { id: string; invited_email: string; role: Role; created_at: string; expires_at: string; invited_by: string | null }
type People = { ranch: { id: string; name: string } | null; me: { user_id: string; role: Role } | null; members: Person[]; invites: Invite[] }

const who = (p: Person) => p.name?.trim() || p.email || 'Someone'
const first = (p: Person) => (p.name?.trim() || p.email || 'they').split(/[\s@]/)[0]
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
const ROW = 'flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2'
const LINK_BTN = 'min-h-[48px] px-2 font-dm-sans text-[16px] font-semibold text-forest-green underline underline-offset-2'

export default function RanchPeopleCard() {
  const [people, setPeople] = useState<People | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<{ email: string; acceptUrl: string; emailed: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<Person | null>(null)

  const load = useCallback(() => {
    return fetch('/api/invitations')
      .then(r => (r.ok ? r.json() : null))
      .then((j: People | null) => setPeople(j && j.ranch ? j : null))
      .catch(() => setPeople(null))
  }, [])
  useEffect(() => { load() }, [load])

  if (!people?.ranch || !people.me) return null
  const isOwner = people.me.role === 'owner'

  const post = async (url: string, body: unknown): Promise<string | null> => {
    setBusy(true); setError('')
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError((j as { error?: string }).error ?? 'Could not save.'); return null }
      await load()
      return JSON.stringify(j)
    } catch { setError('Could not reach the ranch — check your connection and try again.'); return null }
    finally { setBusy(false) }
  }

  async function invite() {
    const raw = await post('/api/invitations', { email, role })
    if (!raw) return
    const j = JSON.parse(raw) as { acceptUrl: string; emailed: boolean; invite: { invited_email: string } }
    setSent({ email: j.invite.invited_email, acceptUrl: j.acceptUrl, emailed: j.emailed }); setCopied(false); setEmail('')
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) }
  }

  return (
    <Card shadow="none" className="mt-5 px-5 py-4" data-audit="ranch-people">
      <p className={EYEBROW}>People on this ranch</p>
      <ul className="mt-2 divide-y divide-forest-green/[0.08]" aria-label="Members">
        {people.members.map(p => (
          <li key={p.user_id} className={ROW} data-audit="member-row">
            <div className="min-w-0">
              <p className="font-dm-sans text-[16px] font-semibold text-forest-green">{who(p)}{p.user_id === people.me!.user_id ? ' (you)' : ''}</p>
              <p className="font-dm-sans text-[16px] text-ink">{p.role === 'owner' ? 'Owner' : 'Member'}{p.email && p.name ? ` · ${p.email}` : ''} · since {fmtDay(p.since)}</p>
            </div>
            {isOwner && p.user_id !== people.me!.user_id && (
              <div className="flex flex-wrap gap-1">
                <button type="button" disabled={busy} className={LINK_BTN} onClick={() => post('/api/members/role', { user_id: p.user_id, role: p.role === 'owner' ? 'member' : 'owner' })}>
                  {p.role === 'owner' ? 'Make member' : 'Make owner'}
                </button>
                <button type="button" disabled={busy} className={LINK_BTN} onClick={() => { setConfirmRemove(p); setError('') }}>Remove</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {confirmRemove && (
        <div role="alertdialog" aria-labelledby="remove-title" className="mt-3 rounded-lg border border-rust/30 bg-rust/[0.04] px-4 py-3" data-audit="remove-confirm">
          <p id="remove-title" className="font-dm-sans text-[16px] font-semibold text-forest-green">Remove {who(confirmRemove)} from {people.ranch.name}?</p>
          <p className="mt-1 font-dm-sans text-[16px] leading-snug text-forest-green">
            {first(confirmRemove)} will no longer see this ranch&rsquo;s records, including entries {first(confirmRemove)} made. Those entries stay in the ranch record.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={async () => { const r = await post('/api/members/remove', { user_id: confirmRemove.user_id }); if (r) setConfirmRemove(null) }}>Remove {first(confirmRemove)}</Button>
            <Button type="button" variant="secondary" onClick={() => setConfirmRemove(null)}>Keep {first(confirmRemove)}</Button>
          </div>
        </div>
      )}

      {people.invites.length > 0 && (
        <>
          <p className={`${EYEBROW} mt-4`}>Invited, not yet joined</p>
          <ul className="mt-1 divide-y divide-forest-green/[0.08]" aria-label="Open invitations">
            {people.invites.map(i => (
              <li key={i.id} className={ROW} data-audit="invite-row">
                <div className="min-w-0">
                  <p className="font-dm-sans text-[16px] font-semibold text-forest-green">{i.invited_email}</p>
                  <p className="font-dm-sans text-[16px] text-ink">{i.role === 'owner' ? 'Owner' : 'Member'} · invited by {i.invited_by ?? 'an owner'} {fmtDay(i.created_at)} · expires in {daysLeft(i.expires_at)} day{daysLeft(i.expires_at) === 1 ? '' : 's'}</p>
                </div>
                {isOwner && <button type="button" disabled={busy} className={LINK_BTN} onClick={() => post('/api/invitations/revoke', { id: i.id })}>Revoke</button>}
              </li>
            ))}
          </ul>
        </>
      )}

      {isOwner && (
        <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); if (!busy && email.trim()) invite() }} data-audit="invite-form">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green">Add someone to this ranch</p>
          <Field label="Their email">
            <Input type="email" inputMode="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </Field>
          <Field label="Role" hint="Members see and log everything on the ranch. Owners can also add and remove people.">
            <Select value={role} onChange={e => setRole(e.target.value as Role)}>
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </Select>
          </Field>
          <Button type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send invitation'}</Button>
        </form>
      )}

      {sent && (
        <div className="mt-3 rounded-lg border border-forest-green/15 bg-forest-green/[0.04] px-4 py-3" data-audit="invite-sent">
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green">
            {sent.emailed ? `Invitation emailed to ${sent.email}.` : `Invitation ready for ${sent.email}.`}
          </p>
          <p className="mt-1 font-dm-sans text-[16px] text-ink">
            {sent.emailed ? 'If it does not arrive, text them this link — it works for their address only, for 7 days.' : 'Text them this link — it works for their address only, for 7 days.'}
          </p>
          <p className="mt-1 break-all font-dm-sans text-[16px] text-forest-green" data-audit="invite-link">{sent.acceptUrl}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => copy(sent.acceptUrl)}>{copied ? 'Copied' : 'Copy link'}</Button>
            <button type="button" className={LINK_BTN} onClick={() => setSent(null)}>Done</button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 font-dm-sans text-[16px] font-medium text-warning" role="alert">{error}</p>}
    </Card>
  )
}
