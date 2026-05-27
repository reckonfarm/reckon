'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

interface County {
  id:    number
  fips:  string
  name:  string
  state: string
  lat:   number | null
  lon:   number | null
}

interface Listing {
  id:               number
  listing_type:     'sell' | 'want' | 'donate'
  hay_type:         string
  tonnage:          number | null
  price_per_ton:    number | null
  contact:          string
  description:      string | null
  haul_radius_miles: number | null
  relief_flag:      boolean
  expires_at:       string
  created_at:       string
  mine:             boolean
  counties:         County
  droughtTier:      number | null
}

const DROUGHT_BADGE: Record<number, { label: string; cls: string }> = {
  1: { label: 'D1', cls: 'bg-yellow-100 text-yellow-800 ring-yellow-200' },
  2: { label: 'D2', cls: 'bg-orange-100 text-orange-800 ring-orange-200' },
  3: { label: 'D3', cls: 'bg-red-100 text-red-700 ring-red-200' },
  4: { label: 'D4', cls: 'bg-red-200 text-red-900 ring-red-300' },
}

const HAY_TYPES = ['Alfalfa', 'Grass', 'Mixed', 'Small Grain', 'Alfalfa-Grass Mix', 'Prairie']

const INPUT_CLS =
  'w-full rounded-xl border border-forest-green/20 bg-white px-4 py-2.5 text-sm font-dm-sans text-forest-green placeholder-forest-green/40 focus:outline-none focus:ring-2 focus:ring-forest-green/30'

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

export default function HayPage() {
  const [authed, setAuthed]         = useState<boolean | null>(null)
  const [listings, setListings]     = useState<Listing[]>([])
  const [listingsLoading, setListingsLoading] = useState(true)
  const [tab, setTab]           = useState<'sell' | 'want'>('sell')
  const [showForm, setShowForm] = useState(false)
  const [refPoint, setRefPoint] = useState<{ lat: number; lon: number } | null>(null)
  const [removing, setRemoving] = useState<Set<number>>(new Set())

  // Form fields
  const [selectedCounty, setSelectedCounty] = useState<County | null>(null)
  const [countyQuery, setCountyQuery]       = useState('')
  const [countyResults, setCountyResults]   = useState<County[]>([])
  const [countyDropOpen, setCountyDropOpen] = useState(false)
  const [listingType, setListingType]       = useState<'sell' | 'want' | 'donate'>('sell')
  const [hayType, setHayType]               = useState('')
  const [tonnage, setTonnage]               = useState('')
  const [pricePerTon, setPricePerTon]       = useState('')
  const [contact, setContact]               = useState('')
  const [description, setDescription]       = useState('')
  const [haulRadius, setHaulRadius]         = useState('')
  const [reliefFlag, setReliefFlag]         = useState(false)
  const [submitting, setSubmitting]         = useState(false)
  const [formError, setFormError]           = useState('')

  const countyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchListings() {
    const data = await fetch('/api/hay').then(r => r.ok ? r.json() : [])
    setListings(Array.isArray(data) ? data : [])
  }

  useEffect(() => {
    const supabase = createClient()

    // Listings are public — fetch immediately, no auth dependency
    fetchListings().finally(() => setListingsLoading(false))

    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      setAuthed(!!user)
      if (user) {
        try {
          const wl = await fetch('/api/watchlist').then(r => r.ok ? r.json() : [])
          const first = Array.isArray(wl) ? wl[0] : null
          if (first?.county?.lat != null && first?.county?.lon != null) {
            setRefPoint({ lat: first.county.lat, lon: first.county.lon })
          }
        } catch {
          // non-fatal
        }
      }
    }

    checkAuth()

    // Re-check auth and re-fetch listings on login/logout so `mine` flags update
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAuth()
      fetchListings()
    })
    return () => subscription.unsubscribe()
  }, [])

  // County search for the form
  useEffect(() => {
    if (countyTimer.current) clearTimeout(countyTimer.current)
    if (!countyQuery.trim()) { setCountyResults([]); setCountyDropOpen(false); return }
    countyTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/counties?search=${encodeURIComponent(countyQuery.trim())}`)
      if (res.ok) {
        const data: County[] = await res.json()
        setCountyResults(data)
        setCountyDropOpen(data.length > 0)
      }
    }, 300)
    return () => { if (countyTimer.current) clearTimeout(countyTimer.current) }
  }, [countyQuery])

  function resetForm() {
    setSelectedCounty(null)
    setCountyQuery('')
    setListingType('sell')
    setHayType('')
    setTonnage('')
    setPricePerTon('')
    setContact('')
    setDescription('')
    setHaulRadius('')
    setReliefFlag(false)
    setFormError('')
  }

  async function submitListing() {
    setFormError('')
    if (!selectedCounty)    { setFormError('Select a county.'); return }
    if (!hayType.trim())    { setFormError('Hay type is required.'); return }
    if (!contact.trim())    { setFormError('Contact info is required.'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/hay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          county_id:         selectedCounty.id,
          listing_type:      listingType,
          hay_type:          hayType.trim(),
          contact:           contact.trim(),
          tonnage:           tonnage           ? parseFloat(tonnage)    : null,
          price_per_ton:     pricePerTon       ? parseFloat(pricePerTon) : null,
          description:       description.trim() || null,
          haul_radius_miles: haulRadius        ? parseInt(haulRadius)   : null,
          relief_flag:       reliefFlag,
        }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setFormError((json as { error?: string }).error ?? 'Failed to post listing.')
        return
      }

      resetForm()
      setShowForm(false)
      await fetchListings()
    } finally {
      setSubmitting(false)
    }
  }

  async function removeListing(id: number) {
    setRemoving(prev => new Set(prev).add(id))
    await fetch('/api/hay', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
    setListings(prev => prev.filter(l => l.id !== id))
    setRemoving(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  const sellListings = listings.filter(l => l.listing_type !== 'want')
  const wantListings = listings.filter(l => l.listing_type === 'want')
  const filtered     = tab === 'sell' ? sellListings : wantListings

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
              Hay Network
            </h1>
            <p className="mt-1 text-sm text-forest-green/50 font-dm-sans">
              Drought-aware hay listings. Buyers and sellers connect offline.
            </p>
          </div>

          {authed ? (
            <button
              onClick={() => { setShowForm(v => !v); if (showForm) resetForm() }}
              className="rounded-lg bg-forest-green px-4 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors"
            >
              {showForm ? 'Cancel' : '+ Post a listing'}
            </button>
          ) : (
            <Link
              href="/signin"
              className="rounded-lg border border-forest-green/20 px-4 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-forest-green/5 transition-colors"
            >
              Sign in to post
            </Link>
          )}
        </div>

        {/* Add listing form */}
        {showForm && authed && (
          <div className="mt-6 rounded-xl border border-forest-green/10 bg-white px-5 py-6 shadow-sm">
            <h2 className="font-fraunces text-base font-semibold text-forest-green mb-4">
              New listing
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">

              {/* County */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                  County *
                </label>
                {selectedCounty ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg border border-forest-green/20 px-3 py-2 text-sm font-dm-sans text-forest-green bg-cream">
                      {selectedCounty.name}, {selectedCounty.state}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setSelectedCounty(null); setCountyQuery('') }}
                      className="text-xs font-dm-sans text-forest-green/50 hover:text-forest-green"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      value={countyQuery}
                      onChange={e => setCountyQuery(e.target.value)}
                      onBlur={() => setTimeout(() => setCountyDropOpen(false), 150)}
                      placeholder="Search county — e.g. Lincoln, NE"
                      className={INPUT_CLS}
                    />
                    {countyDropOpen && (
                      <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-forest-green/15 bg-white shadow-lg">
                        {countyResults.map(c => (
                          <li key={c.fips}>
                            <button
                              type="button"
                              onMouseDown={() => {
                                setSelectedCounty(c)
                                setCountyQuery('')
                                setCountyDropOpen(false)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-dm-sans text-forest-green hover:bg-cream"
                            >
                              {c.name}, {c.state}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Listing type */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                  Type *
                </label>
                <div className="flex gap-4">
                  {(['sell', 'want', 'donate'] as const).map(t => (
                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="listing_type"
                        value={t}
                        checked={listingType === t}
                        onChange={() => setListingType(t)}
                        className="accent-forest-green"
                      />
                      <span className="text-sm font-dm-sans text-forest-green capitalize">{t}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Hay type */}
              <div>
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                  Hay type *
                </label>
                <input
                  list="hay-types"
                  value={hayType}
                  onChange={e => setHayType(e.target.value)}
                  placeholder="e.g. Alfalfa"
                  className={INPUT_CLS}
                />
                <datalist id="hay-types">
                  {HAY_TYPES.map(t => <option key={t} value={t} />)}
                </datalist>
              </div>

              {/* Tonnage */}
              <div>
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                  Tonnage (optional)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={tonnage}
                  onChange={e => setTonnage(e.target.value)}
                  placeholder="e.g. 50"
                  className={INPUT_CLS}
                />
              </div>

              {/* Price per ton (hidden for donate) */}
              {listingType !== 'donate' && (
                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                    Price per ton, $ (optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={pricePerTon}
                    onChange={e => setPricePerTon(e.target.value)}
                    placeholder="e.g. 180"
                    className={INPUT_CLS}
                  />
                </div>
              )}

              {/* Haul radius (sell/donate only) */}
              {listingType !== 'want' && (
                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                    Haul radius, miles (optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={haulRadius}
                    onChange={e => setHaulRadius(e.target.value)}
                    placeholder="e.g. 100"
                    className={INPUT_CLS}
                  />
                </div>
              )}

              {/* Contact */}
              <div>
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                  Contact (phone or email) *
                </label>
                <input
                  type="text"
                  value={contact}
                  onChange={e => setContact(e.target.value)}
                  placeholder="e.g. (402) 555-0101"
                  className={INPUT_CLS}
                />
              </div>

              {/* Description */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                  Details (optional)
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Bale type, delivery info, pickup location…"
                  rows={3}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>

              {/* Relief flag */}
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reliefFlag}
                    onChange={e => setReliefFlag(e.target.checked)}
                    className="accent-forest-green h-4 w-4"
                  />
                  <span className="text-sm font-dm-sans text-forest-green/70">
                    Disaster / drought relief — free or reduced-cost hay for hardship cases
                  </span>
                </label>
              </div>
            </div>

            {formError && (
              <p className="mt-3 text-sm text-red-600 font-dm-sans">{formError}</p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                onClick={submitListing}
                disabled={submitting}
                className="rounded-lg bg-forest-green px-5 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Posting…' : 'Post listing'}
              </button>
              <button
                onClick={() => { setShowForm(false); resetForm() }}
                className="rounded-lg border border-forest-green/20 px-5 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-cream transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="mt-6 flex gap-1 rounded-lg bg-forest-green/5 p-1 w-fit">
          {(['sell', 'want'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'rounded-md px-4 py-1.5 text-sm font-dm-sans font-medium transition-colors',
                tab === t
                  ? 'bg-white text-forest-green shadow-sm'
                  : 'text-forest-green/50 hover:text-forest-green',
              ].join(' ')}
            >
              {t === 'sell'
                ? `For Sale${sellListings.length > 0 ? ` (${sellListings.length})` : ''}`
                : `Wanted${wantListings.length > 0 ? ` (${wantListings.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* Listings */}
        <div className="mt-4">
          {listingsLoading ? (
            <p className="text-sm text-forest-green/50 font-dm-sans">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-forest-green/10 bg-white px-6 py-12 text-center shadow-sm">
              <p className="font-fraunces text-base font-semibold text-forest-green">
                No listings in this area yet.
              </p>
              <p className="mt-2 text-sm text-forest-green/60 font-dm-sans max-w-sm mx-auto">
                Be the first to post — ranchers in D2+ counties nearby will be notified automatically when you list hay for sale.
              </p>
              {!authed && (
                <Link
                  href="/signin"
                  className="mt-4 inline-block text-sm font-dm-sans font-medium text-forest-green underline hover:text-forest-green/70"
                >
                  Sign in to post your first listing →
                </Link>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map(l => {
                const county  = l.counties
                const daysLeft = Math.max(0, Math.ceil(
                  (new Date(l.expires_at).getTime() - Date.now()) / 86400000,
                ))
                const badge = l.droughtTier !== null ? DROUGHT_BADGE[l.droughtTier] : null
                const dist  =
                  refPoint && county.lat != null && county.lon != null
                    ? Math.round(haversine(refPoint.lat, refPoint.lon, county.lat, county.lon))
                    : null

                const priceLabel =
                  l.listing_type === 'donate'
                    ? 'Donation'
                    : l.price_per_ton != null
                      ? `$${l.price_per_ton.toFixed(0)}/ton`
                      : 'Price TBD'

                return (
                  <li
                    key={l.id}
                    className="rounded-xl border border-forest-green/10 bg-white px-4 py-4 shadow-sm sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">

                        {/* Title row */}
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-fraunces text-base font-semibold text-forest-green">
                            {l.hay_type}
                          </h2>
                          {l.listing_type === 'donate' && (
                            <span className="inline-flex items-center rounded-full bg-forest-green/10 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green ring-1 ring-forest-green/20">
                              Donation
                            </span>
                          )}
                          {l.relief_flag && (
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-red-700 ring-1 ring-red-200">
                              Relief
                            </span>
                          )}
                          {badge && (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-dm-sans ring-1 ${badge.cls}`}>
                              {badge.label} Drought
                            </span>
                          )}
                        </div>

                        {/* Location */}
                        <p className="mt-1 text-sm text-forest-green/60 font-dm-sans">
                          {county.name}, {county.state}
                          {dist !== null && (
                            <span className="ml-1 text-forest-green/40">· {dist} mi away</span>
                          )}
                        </p>

                        {/* Details row */}
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-forest-green/50 font-dm-sans">
                          <span>{priceLabel}</span>
                          {l.tonnage != null && <span>{l.tonnage} tons</span>}
                          {l.haul_radius_miles != null && (
                            <span>Hauls up to {l.haul_radius_miles} mi</span>
                          )}
                        </div>

                        {l.description && (
                          <p className="mt-2 text-sm text-forest-green/70 font-dm-sans">
                            {l.description}
                          </p>
                        )}

                        <p className="mt-2 text-sm font-medium text-forest-green font-dm-sans">
                          {l.contact}
                        </p>
                      </div>

                      {/* Right column */}
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className="text-xs text-forest-green/40 font-dm-sans">
                          {daysLeft}d left
                        </span>
                        {l.mine && (
                          <button
                            onClick={() => removeListing(l.id)}
                            disabled={removing.has(l.id)}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 font-dm-sans hover:bg-red-50 disabled:opacity-40"
                          >
                            {removing.has(l.id) ? '…' : 'Remove'}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

      </main>
    </>
  )
}
