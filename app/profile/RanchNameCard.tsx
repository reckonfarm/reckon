'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { Field, Input } from '@/app/components/ui/Field'
import { Button } from '@/app/components/ui/Button'
import { RANCH_NAME_MAX } from '@/lib/ranch-membership'

// The outfit's name (flow, commit 2) — the operation's identity, kept on the
// Profile page above the person's own details. Same load → edit → save shape
// as ProfileForm (promise-chain load, setState only in callbacks). Renders
// nothing until the ranch is known, and nothing at all for a person with no
// ranch membership: no empty state, no placeholder name anywhere.

type Ranch = { id: string; name: string }

export default function RanchNameCard() {
  const router = useRouter()
  const [ranch, setRanch] = useState<Ranch | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/ranch')
      .then(r => (r.ok ? r.json() : { ranch: null }))
      .then((j: { ranch?: Ranch | null }) => {
        if (cancelled) return
        setRanch(j.ranch ?? null)
        setName(j.ranch?.name ?? '')
      })
      .catch(() => { if (!cancelled) setRanch(null) })
    return () => { cancelled = true }
  }, [])

  if (!ranch) return null

  const dirty = name.trim() !== ranch.name

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const res = await fetch('/api/ranch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError((json as { error?: string }).error ?? 'Could not save.'); return }
      setRanch((json as { ranch: Ranch }).ranch)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh()   // the dashboard h1 reads this name on its next render
    } catch {
      setError('Could not save — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card shadow="none" className="mt-5 px-5 py-4">
      <form onSubmit={e => { e.preventDefault(); if (dirty && !saving) save() }} className="space-y-3">
        <Field label="Ranch name" hint="How the operation is named across Dryline — it leads your dashboard.">
          <Input value={name} maxLength={RANCH_NAME_MAX} onChange={e => setName(e.target.value)} />
        </Field>
        {error && <p className="font-dm-sans text-sm font-medium text-warning" role="alert">{error}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!dirty || saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save name'}
          </Button>
          {saved && <span className="font-dm-sans text-sm text-forest-green/60">Saved</span>}
        </div>
      </form>
    </Card>
  )
}
