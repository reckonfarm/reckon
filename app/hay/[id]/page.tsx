'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'
import type { HayListingDetail, HayCounty } from '@/lib/types/hay'

const DROUGHT_LABEL: Record<number, { label: string; cls: string }> = {
  1: { label: 'D1 County', cls: 'bg-yellow-100 text-yellow-800 ring-yellow-200' },
  2: { label: 'D2 County', cls: 'bg-orange-100 text-orange-800 ring-orange-200' },
  3: { label: 'D3 County', cls: 'bg-red-100 text-red-700 ring-red-200' },
  4: { label: 'D4 County', cls: 'bg-red-200 text-red-900 ring-red-300' },
}

const BALE_TYPE_LABELS: Record<string, string> = {
  large_round:   'Large Round',
  small_round:   'Small Round',
  small_square:  'Small Square',
  '3string_square': '3-String Square',
  '4string_square': '4-String Square',
}

const STORAGE_LABELS: Record<string, string> = {
  outside: 'Outside',
  covered: 'Covered',
  barn:    'Barn Stored',
}

const ORDINALS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' }

function isEmail(contact: string) {
  return contact.includes('@')
}

function daysAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days === 0) return 'Listed today'
  return `Listed ${days} day${days === 1 ? '' : 's'} ago`
}

function formatExpiry(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

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

function proteinNote(pct: number): string {
  if (pct < 7)  return 'Below average for beef cattle'
  if (pct <= 11) return 'Adequate for beef maintenance'
  if (pct <= 16) return 'Good quality'
  return 'Excellent — suitable for high-performance livestock'
}

function moistureNote(pct: number): string {
  if (pct < 15)  return 'Dry — low mold risk'
  if (pct <= 20) return 'Acceptable'
  return 'High moisture — storage risk'
}

function tdnNote(pct: number): string {
  if (pct < 52)  return 'Low energy'
  if (pct <= 59) return 'Average'
  return 'High energy'
}

function rfvNote(val: number): string {
  if (val < 100) return 'Fair'
  if (val < 125) return 'Good'
  if (val <= 150) return 'Premium'
  return 'Supreme'
}

function formatSellerSince(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function renderStars(avg: number): string {
  const n = Math.round(avg)
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

function sellerActivityLabel(sinceStr: string): string | null {
  const days = Math.floor((Date.now() - new Date(sinceStr).getTime()) / 86400000)
  if (days < 7) return null
  if (days <= 30) return 'New to Dryline'
  return 'Active seller'
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-forest-green/50 font-dm-sans uppercase tracking-wide">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-dm-sans text-forest-green font-medium">
        {value}
      </dd>
    </div>
  )
}

function TestRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-forest-green/8 last:border-0">
      <div>
        <p className="text-sm font-medium font-dm-sans text-forest-green">{label}</p>
        <p className="text-xs text-forest-green/50 font-dm-sans mt-0.5">{note}</p>
      </div>
      <span className="text-sm font-semibold font-dm-sans text-forest-green shrink-0">{value}</span>
    </div>
  )
}

export default function HayDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [listing, setListing]   = useState<HayListingDetail | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [refPoint, setRefPoint] = useState<{ lat: number; lon: number } | null>(null)

  useEffect(() => {
    if (!id) return

    fetch(`/api/hay/${id}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.ok ? r.json() : null
      })
      .then(data => { if (data) setListing(data) })
      .finally(() => setLoading(false))

    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      fetch('/api/watchlist')
        .then(r => r.ok ? r.json() : [])
        .then(wl => {
          const first = Array.isArray(wl) ? wl[0] : null
          if (first?.county?.lat != null && first?.county?.lon != null) {
            setRefPoint({ lat: first.county.lat, lon: first.county.lon })
          }
        })
        .catch(() => {})
    })
  }, [id])

  if (loading) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <p className="text-sm text-forest-green/50 font-dm-sans">Loading…</p>
        </main>
      </>
    )
  }

  if (notFound || !listing) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 text-center">
          <p className="font-fraunces text-xl font-semibold text-forest-green">Listing not found</p>
          <p className="mt-2 text-sm text-forest-green/60 font-dm-sans">
            This listing may have expired or been removed.
          </p>
          <Link href="/hay" className="mt-4 inline-block text-sm font-dm-sans font-medium text-forest-green underline hover:text-forest-green/70">
            ← Back to Hay Network
          </Link>
        </main>
      </>
    )
  }

  const county     = listing.counties ?? null
  const droughtBadge = listing.droughtTier !== null ? DROUGHT_LABEL[listing.droughtTier] : null
  const emailContact = isEmail(listing.contact ?? '')
  const contactHref  = emailContact ? `mailto:${listing.contact}` : `tel:${listing.contact}`
  const contactLabel = listing.listing_type === 'want' ? 'Contact Buyer' : (emailContact ? 'Email Seller' : 'Call Seller')

  const dist = refPoint && county != null && county.lat != null && county.lon != null
    ? Math.round(haversine(refPoint.lat, refPoint.lon, county.lat, county.lon))
    : null

  const hasTest =
    listing.hay_test_protein_pct  != null ||
    listing.hay_test_tdn_pct      != null ||
    listing.hay_test_rfv          != null ||
    listing.hay_test_moisture_pct != null

  const title = listing.cutting_number
    ? `${listing.hay_type} — ${ORDINALS[listing.cutting_number]} Cutting`
    : listing.hay_type

  // Quantity display
  let quantityDisplay: string | null = null
  if (listing.tonnage != null && listing.bale_weight_lbs != null) {
    const estimatedBales = Math.round((listing.tonnage * 2000) / listing.bale_weight_lbs)
    quantityDisplay = `~${estimatedBales} bales (${listing.tonnage} tons)`
  } else if (listing.tonnage != null) {
    quantityDisplay = `${listing.tonnage} tons`
  }

  // Price display
  const priceDisplay =
    listing.listing_type === 'donate'
      ? 'Donation'
      : listing.price_per_ton != null
        ? `$${listing.price_per_ton.toFixed(0)}/ton`
        : 'Make offer'

  // Haul display
  const haulDisplay =
    listing.haul_radius_miles && listing.haul_radius_miles > 0
      ? `Will deliver up to ${listing.haul_radius_miles} miles`
      : 'Pickup only'

  // Listing type badge
  const typeBadge =
    listing.listing_type === 'sell'    ? { label: 'FOR SALE',  cls: 'bg-rust/10 text-rust ring-rust/20' }
    : listing.listing_type === 'donate' ? { label: 'DONATION', cls: 'bg-forest-green/10 text-forest-green ring-forest-green/20' }
    :                                     { label: 'WANTED',   cls: 'bg-amber-100 text-amber-800 ring-amber-200' }

  const droughtContextText = listing.droughtTier !== null
    ? `${county?.name ?? ''} County is currently in D${listing.droughtTier} drought. Ranchers in this area may need feed urgently.`
    : `${county?.name ?? ''} County is not currently in drought.`

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">

        {/* Back link */}
        <Link
          href="/hay"
          className="inline-flex items-center gap-1 text-sm font-dm-sans text-forest-green/60 hover:text-forest-green transition-colors mb-6"
        >
          ← Back to Hay Network
        </Link>

        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-dm-sans tracking-wide ring-1 ${typeBadge.cls}`}>
              {typeBadge.label}
            </span>
            {droughtBadge && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium font-dm-sans ring-1 ${droughtBadge.cls}`}>
                {droughtBadge.label}
              </span>
            )}
            <span className="text-xs text-forest-green/40 font-dm-sans">{daysAgo(listing.created_at)}</span>
          </div>
          <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
            {title}
          </h1>
          <p className="mt-1 text-sm text-forest-green/60 font-dm-sans">
            {county?.name}, {county?.state}
            {dist !== null && (
              <span className="ml-1 text-forest-green/40">· {dist} miles from your watched county</span>
            )}
          </p>
        </div>

        {/* Relief banner */}
        {listing.relief_flag && (
          <div className="mb-5 rounded-xl bg-forest-green/8 border border-forest-green/15 px-4 py-3">
            <p className="text-sm font-medium font-dm-sans text-forest-green">
              Disaster Relief Listing — This seller is offering hay for emergency drought or disaster relief.
            </p>
          </div>
        )}

        {/* CTA — above the fold on mobile */}
        <div className="mb-6 rounded-xl border border-forest-green/10 bg-white px-5 py-5 shadow-sm">
          <a
            href={contactHref}
            className="flex w-full items-center justify-center rounded-xl bg-forest-green px-6 py-4 font-dm-sans text-base font-semibold text-cream hover:bg-forest-green/90 transition-colors"
          >
            {contactLabel}
          </a>
          <p className="mt-3 text-center text-sm font-dm-sans text-forest-green/70">
            {listing.contact}
          </p>
        </div>

        {/* Key details */}
        <div className="mb-5 rounded-xl border border-forest-green/10 bg-white px-5 py-5 shadow-sm">
          <h2 className="font-fraunces text-base font-semibold text-forest-green mb-4">Listing Details</h2>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <DetailRow label="Hay Type" value={listing.hay_type} />
            {listing.bale_type && (
              <DetailRow label="Bale Type" value={BALE_TYPE_LABELS[listing.bale_type] ?? listing.bale_type} />
            )}
            {quantityDisplay && (
              <DetailRow label="Quantity" value={quantityDisplay} />
            )}
            <DetailRow label="Price" value={priceDisplay} />
            {listing.cutting_number != null && (
              <DetailRow label="Cutting" value={`${ORDINALS[listing.cutting_number]} cutting`} />
            )}
            {listing.bale_weight_lbs != null && (
              <DetailRow label="Bale Weight" value={`${listing.bale_weight_lbs} lbs avg`} />
            )}
            {listing.storage_method && (
              <DetailRow label="Storage" value={STORAGE_LABELS[listing.storage_method] ?? listing.storage_method} />
            )}
            <DetailRow label="Delivery" value={haulDisplay} />
            <DetailRow label="Location" value={`${county?.name ?? ''}, ${county?.state ?? ''}`} />
            {dist !== null && (
              <DetailRow label="Distance" value={`${dist} miles from your watched county`} />
            )}
          </dl>
        </div>

        {/* Description */}
        {listing.description && (
          <div className="mb-5 rounded-xl border border-forest-green/10 bg-white px-5 py-5 shadow-sm">
            <h2 className="font-fraunces text-base font-semibold text-forest-green mb-2">From the Seller</h2>
            <p className="text-sm font-dm-sans text-forest-green/80 leading-relaxed whitespace-pre-wrap">
              {listing.description}
            </p>
          </div>
        )}

        {/* Hay test results */}
        {hasTest && (
          <div className="mb-5 rounded-xl border border-forest-green/10 bg-white px-5 py-5 shadow-sm">
            <h2 className="font-fraunces text-base font-semibold text-forest-green mb-1">Forage Test Results</h2>
            <div className="mt-3">
              {listing.hay_test_protein_pct != null && (
                <TestRow
                  label="Crude Protein"
                  value={`${listing.hay_test_protein_pct}%`}
                  note={proteinNote(listing.hay_test_protein_pct)}
                />
              )}
              {listing.hay_test_moisture_pct != null && (
                <TestRow
                  label="Moisture"
                  value={`${listing.hay_test_moisture_pct}%`}
                  note={moistureNote(listing.hay_test_moisture_pct)}
                />
              )}
              {listing.hay_test_tdn_pct != null && (
                <TestRow
                  label="TDN"
                  value={`${listing.hay_test_tdn_pct}%`}
                  note={tdnNote(listing.hay_test_tdn_pct)}
                />
              )}
              {listing.hay_test_rfv != null && (
                <TestRow
                  label="RFV"
                  value={`${listing.hay_test_rfv}`}
                  note={rfvNote(listing.hay_test_rfv)}
                />
              )}
            </div>
            <p className="mt-3 text-xs text-forest-green/45 font-dm-sans leading-snug">
              Test results provided by seller. Independent verification recommended for large purchases.
            </p>
          </div>
        )}

        {/* Drought context */}
        <div className="mb-5 rounded-xl border border-forest-green/10 bg-white px-5 py-5 shadow-sm">
          <h2 className="font-fraunces text-base font-semibold text-forest-green mb-2">Drought Context</h2>
          <p className="text-sm font-dm-sans text-forest-green/80">{droughtContextText}</p>
          <Link
            href={`/dashboard?fips=${county?.fips ?? ''}`}
            className="mt-2 inline-block text-sm font-dm-sans font-medium text-forest-green underline hover:text-forest-green/70"
          >
            View {county?.name ?? ''} drought dashboard →
          </Link>
        </div>

        {/* About the Seller */}
        <div className="mb-5 rounded-xl border border-forest-green/10 bg-white px-5 py-4 shadow-sm">
          <h2 className="font-fraunces text-base font-semibold text-forest-green mb-3">About the Seller</h2>

          {/* Name + verified badge */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium font-dm-sans text-forest-green">
              {listing.display_name ?? 'Dryline Member'}
            </span>
            {listing.verified_phone && (
              <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-green-700 ring-1 ring-green-200">
                ✓ Verified
              </span>
            )}
          </div>

          {/* Star rating or new seller label */}
          {(listing.seller_review_count ?? 0) > 0 ? (
            <p className="text-sm font-dm-sans text-forest-green/80 mb-2">
              {renderStars(listing.seller_avg_rating!)}
              <span className="ml-1 text-forest-green/50">
                ({listing.seller_review_count} review{listing.seller_review_count === 1 ? '' : 's'})
              </span>
            </p>
          ) : (
            <p className="text-xs font-dm-sans text-forest-green/40 mb-2">New seller</p>
          )}

          {/* Member since + listing count */}
          {listing.seller_since && (
            <p className="text-xs font-dm-sans text-forest-green/50">
              Seller on Dryline since {formatSellerSince(listing.seller_since)}
              {' · '}
              {listing.seller_listing_count} active listing{listing.seller_listing_count === 1 ? '' : 's'}
            </p>
          )}

          {/* Account age heuristic (Part D) */}
          {listing.seller_since && sellerActivityLabel(listing.seller_since) && (
            <p className="mt-1 text-xs font-dm-sans text-forest-green/40">
              {sellerActivityLabel(listing.seller_since)}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-forest-green/40 font-dm-sans">
          <span>{daysAgo(listing.created_at)}</span>
          <span>Expires {formatExpiry(listing.expires_at ?? '')}</span>
          <a
            href={`mailto:kiehl.preston@gmail.com?subject=Report hay listing %23${listing.id}&body=Listing ID: ${listing.id}%0ACounty: ${county?.name ?? ''}, ${county?.state ?? ''}%0AReason: `}
            className="hover:text-forest-green/70 transition-colors"
          >
            Report this listing
          </a>
        </div>

      </main>
    </>
  )
}
