'use client'

import { useState, useEffect } from 'react'

const INPUT_CLS =
  'w-full rounded-xl border border-forest-green/20 bg-white px-4 py-2.5 text-sm font-dm-sans text-forest-green placeholder-forest-green/40 focus:outline-none focus:ring-2 focus:ring-forest-green/30'

interface Profile {
  id:                  string
  email:               string | null
  display_name:        string | null
  bio:                 string | null
  phone:               string | null
  verified_phone:      boolean | null
  total_sales:         number | null
  seller_avg_rating:   number | null
  seller_review_count: number | null
  operation_type:      string | null
  region:              string | null
  demand_routing_opt_in: boolean | null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function ProfileForm() {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [email, setEmail] = useState<string | null>(null)
  const [verifiedPhone, setVerifiedPhone] = useState(false)

  const [displayName, setDisplayName]   = useState('')
  const [bio, setBio]                   = useState('')
  const [phone, setPhone]               = useState('')
  const [operationType, setOperationType] = useState('')
  const [region, setRegion]             = useState('')
  const [demandOptIn, setDemandOptIn]   = useState(false)

  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load profile')))
      .then((p: Profile | null) => {
        if (p) {
          setEmail(p.email)
          setVerifiedPhone(!!p.verified_phone)
          setDisplayName(p.display_name ?? '')
          setBio(p.bio ?? '')
          setPhone(p.phone ?? '')
          setOperationType(p.operation_type ?? '')
          setRegion(p.region ?? '')
          setDemandOptIn(!!p.demand_routing_opt_in)
        }
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setSaveError('')
    setSaved(false)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name:   displayName,
          bio,
          phone,
          operation_type: operationType,
          region,
          demand_routing_opt_in: demandOptIn,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setSaveError((json as { error?: string }).error ?? 'Could not save.')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-8 space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-12 rounded-xl bg-forest-green/8 animate-pulse" />
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <p className="mt-8 rounded-xl border border-rust/20 bg-rust/5 px-4 py-3 text-sm font-dm-sans text-rust">
        {loadError}
      </p>
    )
  }

  return (
    <div className="mt-8 rounded-xl border border-forest-green/10 bg-white px-5 py-6 shadow-sm">
      <div className="grid gap-5">

        {/* Email — read-only */}
        <Field label="Email">
          <div className="flex items-center rounded-xl border border-forest-green/15 bg-cream px-4 py-2.5">
            <span className="text-sm font-dm-sans text-forest-green/70">{email ?? '—'}</span>
          </div>
          <p className="mt-1 text-xs font-dm-sans text-forest-green/40">Your sign-in email can&apos;t be changed here.</p>
        </Field>

        {/* Phone verification status */}
        <Field label="Phone">
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="e.g. (402) 555-0101"
            className={INPUT_CLS}
          />
          <div className="mt-1.5">
            {verifiedPhone ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-green-700 ring-1 ring-green-200">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Phone verified
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green/50 ring-1 ring-forest-green/15">
                Not verified yet
              </span>
            )}
          </div>
        </Field>

        <Field label="Display name">
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="How buyers see you — e.g. Bar K Ranch"
            maxLength={60}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Operation type">
          <input
            type="text"
            value={operationType}
            onChange={e => setOperationType(e.target.value)}
            placeholder="e.g. Cow-calf, Hay producer, Feedlot"
            maxLength={60}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Region">
          <input
            type="text"
            value={region}
            onChange={e => setRegion(e.target.value)}
            placeholder="e.g. Western Nebraska, Sandhills"
            maxLength={80}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Bio">
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Tell buyers about your operation, your hay, how you do business…"
            rows={4}
            maxLength={500}
            className={`${INPUT_CLS} resize-none`}
          />
          <p className="mt-1 text-right text-xs font-dm-sans text-forest-green/40">{bio.length}/500</p>
        </Field>

        {/* Buyer-demand alerts opt-in */}
        <div className="rounded-xl border border-forest-green/15 bg-cream/60 px-4 py-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={demandOptIn}
              onChange={e => setDemandOptIn(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-forest-green"
            />
            <span>
              <span className="block text-sm font-medium font-dm-sans text-forest-green">
                Email me when a buyer near me is looking for hay I have
              </span>
              <span className="mt-0.5 block text-xs font-dm-sans text-forest-green/55">
                When a rancher posts a &ldquo;wanted&rdquo; listing for hay you have within haul range,
                we&apos;ll email you so you can respond. Off by default; at most a few per week. Turn off anytime.
              </span>
            </span>
          </label>
        </div>

        {saveError && (
          <p className="text-sm font-dm-sans text-rust">{saveError}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-forest-green px-5 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 font-dm-sans text-sm font-medium text-forest-green">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
