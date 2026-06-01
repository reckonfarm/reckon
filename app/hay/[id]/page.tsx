'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { trackEvent } from '@/lib/analytics'
import SiteHeader from '@/app/components/SiteHeader'
import MarketplaceDisclaimer from '@/app/components/MarketplaceDisclaimer'
import type { HayListingDetail, HayCounty } from '@/lib/types/hay'
import { deliveredCost, FREIGHT_RATE_PER_TON_MILE, ROAD_CIRCUITY_FACTOR } from '@/lib/freight'

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

const INPUT_CLS =
  'w-full rounded-xl border border-forest-green/20 bg-white px-4 py-2.5 text-sm font-dm-sans text-forest-green placeholder-forest-green/40 focus:outline-none focus:ring-2 focus:ring-forest-green/30'

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
  const searchParams = useSearchParams()
  const router = useRouter()
  const [openingThread, setOpeningThread] = useState(false)
  const [listing, setListing]   = useState<HayListingDetail | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [refPoint, setRefPoint] = useState<{ lat: number; lon: number } | null>(null)
  const [refName, setRefName]   = useState<string | null>(null)
  const [deliverPoint, setDeliverPoint] = useState<{ lat: number; lon: number } | null>(null)
  const [deliverName, setDeliverName]   = useState<string | null>(null)
  const [authed, setAuthed]     = useState<boolean | null>(null)
  const viewTracked = useRef(false)

  // Deal action state
  const [acting, setActing]       = useState(false)
  const [actionError, setActionError] = useState('')

  // Review modal state
  const [showReview, setShowReview]   = useState(false)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)
  const [reviewError, setReviewError] = useState('')

  const [showReport, setShowReport]       = useState(false)
  const [reportReason, setReportReason]   = useState('')
  const [reportNote, setReportNote]       = useState('')
  const [submittingReport, setSubmittingReport] = useState(false)
  const [reportError, setReportError]     = useState('')
  const [reportDone, setReportDone]       = useState(false)

  const loadListing = useCallback(() => {
    return fetch(`/api/hay/${id}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (data) {
          setListing(data); setNotFound(false)
          // Once per listing view — loadListing also reruns after deal actions.
          if (!viewTracked.current) {
            viewTracked.current = true
            trackEvent('hay_listing_viewed', { listing_id: Number(id) })
          }
        }
      })
  }, [id])

  useEffect(() => {
    if (!id) return

    loadListing().finally(() => setLoading(false))

    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setAuthed(!!user)
      if (!user) return
      fetch('/api/watchlist')
        .then(r => r.ok ? r.json() : [])
        .then(wl => {
          const first = Array.isArray(wl) ? wl[0] : null
          if (first?.county?.lat != null && first?.county?.lon != null) {
            setRefPoint({ lat: first.county.lat, lon: first.county.lon })
            setRefName(`${first.county.name}, ${first.county.state}`)
          }
        })
        .catch(() => {})
    })
  }, [id, loadListing])

  // Resolve ?deliverTo=fips → buyer county for the delivered-cost breakdown.
  // Falls back to the watchlist county when no param is set.
  const deliverToParam = searchParams.get('deliverTo')
  useEffect(() => {
    if (!deliverToParam) { setDeliverPoint(null); setDeliverName(null); return }
    let cancelled = false
    fetch(`/api/counties?search=${encodeURIComponent(deliverToParam)}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: HayCounty[]) => {
        if (cancelled) return
        const exact = Array.isArray(rows) ? rows.find(c => c.fips === deliverToParam) : null
        if (exact && exact.lat != null && exact.lon != null) {
          setDeliverPoint({ lat: exact.lat, lon: exact.lon })
          setDeliverName(`${exact.name}, ${exact.state}`)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [deliverToParam])

  // ── Deal actions ───────────────────────────────────────────────────────────
  async function runAction(path: string, method: 'POST' | 'DELETE', body?: unknown) {
    setActing(true)
    setActionError('')
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setActionError((json as { error?: string }).error ?? 'Something went wrong.')
        return false
      }
      await loadListing()
      return true
    } finally {
      setActing(false)
    }
  }

  async function messageOwner() {
    setOpeningThread(true)
    setActionError('')
    try {
      const res = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: Number(id) }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setActionError((json as { error?: string }).error ?? 'Could not open a conversation.')
        return
      }
      trackEvent('contact_seller_clicked', { listing_id: Number(id) })
      const { id: threadId } = await res.json()
      router.push(`/messages?thread=${threadId}`)
    } finally {
      setOpeningThread(false)
    }
  }

  async function submitReview() {
    if (reviewRating < 1) { setReviewError('Pick a star rating.'); return }
    setSubmittingReview(true)
    setReviewError('')
    try {
      const res = await fetch(`/api/hay/${id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setReviewError((json as { error?: string }).error ?? 'Could not submit review.')
        return
      }
      setShowReview(false)
      setReviewRating(0)
      setReviewComment('')
      await loadListing()
    } finally {
      setSubmittingReview(false)
    }
  }

  function openReport() {
    setReportReason('')
    setReportNote('')
    setReportError('')
    setReportDone(false)
    setShowReport(true)
  }

  async function submitReport() {
    if (!reportReason) { setReportError('Pick a reason.'); return }
    setSubmittingReport(true)
    setReportError('')
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listing?.id, reason: reportReason, note: reportNote }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setReportError((json as { error?: string }).error ?? 'Could not file report.')
        return
      }
      setReportDone(true)
    } finally {
      setSubmittingReport(false)
    }
  }

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
          <Link href={`/hay${deliverToParam ? `?deliverTo=${deliverToParam}` : ''}`} className="mt-4 inline-block text-sm font-dm-sans font-medium text-forest-green underline hover:text-forest-green/70">
            ← Back to Hay Network
          </Link>
        </main>
      </>
    )
  }

  const county       = listing.counties ?? null
  const droughtBadge = listing.droughtTier !== null ? DROUGHT_LABEL[listing.droughtTier] : null
  const messageLabel = listing.listing_type === 'want' ? 'Message buyer' : 'Message seller'

  const isSold = listing.sold_at != null

  // Buyer county: explicit ?deliverTo override, else the watchlist county.
  const buyerPoint = deliverPoint ?? refPoint
  const buyerName  = deliverName ?? refName
  const dc = deliveredCost(buyerPoint, listing)

  const dist = buyerPoint && county != null && county.lat != null && county.lon != null
    ? Math.round(haversine(buyerPoint.lat, buyerPoint.lon, county.lat, county.lon))
    : null

  const hasTest =
    listing.hay_test_protein_pct  != null ||
    listing.hay_test_tdn_pct      != null ||
    listing.hay_test_rfv          != null ||
    listing.hay_test_moisture_pct != null

  const title = listing.cutting_number
    ? `${listing.hay_type} — ${ORDINALS[listing.cutting_number]} Cutting`
    : listing.hay_type

  let quantityDisplay: string | null = null
  if (listing.tonnage != null && listing.bale_weight_lbs != null) {
    const estimatedBales = Math.round((listing.tonnage * 2000) / listing.bale_weight_lbs)
    quantityDisplay = `~${estimatedBales} bales (${listing.tonnage} tons)`
  } else if (listing.tonnage != null) {
    quantityDisplay = `${listing.tonnage} tons`
  }

  const priceDisplay =
    listing.listing_type === 'donate'
      ? 'Donation'
      : listing.price_per_ton != null
        ? `$${listing.price_per_ton.toFixed(0)}/ton`
        : 'Make offer'

  const haulDisplay =
    listing.haul_radius_miles && listing.haul_radius_miles > 0
      ? `Will deliver up to ${listing.haul_radius_miles} miles`
      : 'Pickup only'

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
          href={`/hay${deliverToParam ? `?deliverTo=${deliverToParam}` : ''}`}
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
            {isSold && (
              <span className="inline-flex items-center rounded-full bg-forest-green px-2.5 py-0.5 text-xs font-semibold font-dm-sans tracking-wide text-cream">
                SOLD
              </span>
            )}
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

        {/* Photo grid */}
        {listing.photo_urls && listing.photo_urls.length > 0 && (
          <div className={`mb-6 grid gap-2 ${listing.photo_urls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {listing.photo_urls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Photo ${i + 1}`}
                className="w-full rounded-xl object-cover"
                style={{ maxHeight: i === 0 && listing.photo_urls!.length > 1 ? 240 : 200 }}
              />
            ))}
          </div>
        )}

        {/* Relief banner */}
        {listing.relief_flag && (
          <div className="mb-5 rounded-xl bg-forest-green/8 border border-forest-green/15 px-4 py-3">
            <p className="text-sm font-medium font-dm-sans text-forest-green">
              Disaster Relief Listing — This seller is offering hay for emergency drought or disaster relief.
            </p>
          </div>
        )}

        {/* ── Deal action / messaging card ──────────────────────────────────── */}
        {isSold ? (
          <div className="mb-6 rounded-xl border border-forest-green/10 bg-white px-5 py-5 shadow-sm">
            <p className="font-fraunces text-base font-semibold text-forest-green">This listing has been sold</p>
            {listing.viewer_has_reviewed ? (
              <p className="mt-2 text-sm font-dm-sans text-forest-green/60">
                Thanks — you&apos;ve reviewed this deal.
              </p>
            ) : listing.viewer_can_review ? (
              <>
                <p className="mt-2 text-sm font-dm-sans text-forest-green/70">
                  How did it go with {listing.counterparty_name}? Your review builds trust on the network.
                </p>
                {actionError && <p className="mt-2 text-sm font-dm-sans text-rust">{actionError}</p>}
                <button
                  onClick={() => { setShowReview(true); setReviewError('') }}
                  className="mt-3 rounded-lg bg-forest-green px-5 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors"
                >
                  Rate {listing.counterparty_role === 'seller' ? 'the seller' : 'the buyer'}
                </button>
              </>
            ) : (
              <p className="mt-2 text-sm font-dm-sans text-forest-green/60">
                This hay is no longer available.
              </p>
            )}
          </div>
        ) : (
          <div className="mb-6 rounded-xl border border-forest-green/10 bg-white px-5 py-5 shadow-sm">
            {listing.is_owner ? (
              <>
                <Link
                  href="/messages"
                  className="flex w-full items-center justify-center rounded-xl bg-forest-green px-6 py-4 font-dm-sans text-base font-semibold text-cream hover:bg-forest-green/90 transition-colors"
                >
                  View messages
                </Link>
                <p className="mt-3 text-center text-sm font-dm-sans text-forest-green/60">
                  Buyers reach you through private messages — your contact details stay hidden.
                </p>
                <div className="mt-4 border-t border-forest-green/8 pt-4">
                  <p className="text-sm font-dm-sans text-forest-green/70">
                    Sold this hay off-platform? Mark it sold to close the listing.
                  </p>
                  {actionError && <p className="mt-2 text-sm font-dm-sans text-rust">{actionError}</p>}
                  <button
                    onClick={() => runAction(`/api/hay/${id}/sold`, 'POST', { buyer: 'external' })}
                    disabled={acting}
                    className="mt-2 rounded-lg border border-forest-green/20 px-4 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-forest-green/5 disabled:opacity-50 transition-colors"
                  >
                    {acting ? '…' : 'Mark sold (off-platform)'}
                  </button>
                </div>
              </>
            ) : authed ? (
              <>
                <button
                  onClick={messageOwner}
                  disabled={openingThread}
                  className="flex w-full items-center justify-center rounded-xl bg-forest-green px-6 py-4 font-dm-sans text-base font-semibold text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors"
                >
                  {openingThread ? 'Opening…' : messageLabel}
                </button>
                {actionError && <p className="mt-2 text-center text-sm font-dm-sans text-rust">{actionError}</p>}
                <p className="mt-3 text-center text-sm font-dm-sans text-forest-green/60">
                  Message privately and make an offer — no phone numbers exchanged until you choose to.
                </p>
              </>
            ) : (
              <>
                <Link
                  href="/signin"
                  className="flex w-full items-center justify-center rounded-xl bg-forest-green px-6 py-4 font-dm-sans text-base font-semibold text-cream hover:bg-forest-green/90 transition-colors"
                >
                  Sign in to {messageLabel.toLowerCase()}
                </Link>
                <p className="mt-3 text-center text-sm font-dm-sans text-forest-green/60">
                  Contact happens through private messages on Dryline.
                </p>
              </>
            )}
          </div>
        )}

        {/* Estimated delivered cost — the number a rancher actually decides on */}
        {dc && (
          <div className="mb-5 rounded-xl border border-forest-green/10 bg-white px-5 py-5 shadow-sm">
            <h2 className="font-fraunces text-base font-semibold text-forest-green mb-1">Estimated delivered cost</h2>
            <p className="font-fraunces text-3xl font-semibold text-forest-green leading-none">
              ${dc.delivered}
              <span className="ml-1.5 font-dm-sans text-base font-medium text-forest-green/60">/ton est. delivered</span>
            </p>
            {buyerName && (
              <p className="mt-1 text-sm font-dm-sans text-forest-green/60">to {buyerName}</p>
            )}

            <dl className="mt-4 space-y-2 border-t border-forest-green/8 pt-4">
              <div className="flex items-center justify-between">
                <dt className="text-sm font-dm-sans text-forest-green/70">Listing price</dt>
                <dd className="text-sm font-dm-sans font-medium text-forest-green">${dc.base}/ton</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm font-dm-sans text-forest-green/70">Est. freight (~{dc.miles} mi road)</dt>
                <dd className="text-sm font-dm-sans font-medium text-forest-green">+ ${dc.freightPerTon}/ton</dd>
              </div>
              <div className="flex items-center justify-between border-t border-forest-green/8 pt-2">
                <dt className="text-sm font-dm-sans font-semibold text-forest-green">Est. delivered</dt>
                <dd className="text-sm font-dm-sans font-semibold text-forest-green">${dc.delivered}/ton</dd>
              </div>
            </dl>

            <p className="mt-3 text-xs text-forest-green/45 font-dm-sans leading-snug">
              Estimate only — not a freight quote. Assumes a full truckload (~25 tons) at
              {' '}${FREIGHT_RATE_PER_TON_MILE.toFixed(2)}/ton-mile over road miles
              (straight-line distance × {ROAD_CIRCUITY_FACTOR} for road circuity).
              Partial loads cost more per ton. Confirm actual freight with your hauler.
            </p>
          </div>
        )}

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

          <div className="flex items-center gap-2 mb-1">
            {listing.seller_user_id ? (
              <Link
                href={`/sellers/${listing.seller_user_id}`}
                className="text-sm font-medium font-dm-sans text-forest-green underline hover:text-forest-green/70"
              >
                {listing.display_name ?? 'Dryline Member'}
              </Link>
            ) : (
              <span className="text-sm font-medium font-dm-sans text-forest-green">
                {listing.display_name ?? 'Dryline Member'}
              </span>
            )}
            {listing.verified_phone && (
              <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-green-700 ring-1 ring-green-200">
                ✓ Verified
              </span>
            )}
          </div>

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

          {listing.seller_since && (
            <p className="text-xs font-dm-sans text-forest-green/50">
              Seller on Dryline since {formatSellerSince(listing.seller_since)}
              {' · '}
              {listing.seller_listing_count} active listing{listing.seller_listing_count === 1 ? '' : 's'}
            </p>
          )}

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
          <button
            type="button"
            onClick={openReport}
            className="hover:text-forest-green/70 transition-colors"
          >
            Report this listing
          </button>
        </div>

        <MarketplaceDisclaimer className="mt-6 border-t border-forest-green/10 pt-4" />

      </main>

      {/* ── Review modal ─────────────────────────────────────────────────────── */}
      {showReview && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-cream px-5 py-6 shadow-xl">
            <h2 className="font-fraunces text-lg font-semibold text-forest-green">
              Rate {listing.counterparty_name ?? (listing.counterparty_role === 'seller' ? 'the seller' : 'the buyer')}
            </h2>
            <p className="mt-1 text-sm font-dm-sans text-forest-green/60">
              Your review is tied to this completed deal and helps other ranchers trade with confidence.
            </p>

            {/* Stars */}
            <div className="mt-4 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setReviewRating(n)}
                  className={`text-3xl leading-none transition-colors ${
                    n <= reviewRating ? 'text-rust' : 'text-forest-green/20 hover:text-forest-green/40'
                  }`}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  ★
                </button>
              ))}
            </div>

            <textarea
              value={reviewComment}
              onChange={e => setReviewComment(e.target.value)}
              placeholder="How was the hay, the haul, the communication? (optional)"
              rows={4}
              maxLength={1000}
              className={`${INPUT_CLS} mt-4 resize-none`}
            />

            {reviewError && <p className="mt-2 text-sm font-dm-sans text-rust">{reviewError}</p>}

            <div className="mt-4 flex gap-3">
              <button
                onClick={submitReview}
                disabled={submittingReview}
                className="rounded-lg bg-forest-green px-5 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors"
              >
                {submittingReview ? 'Submitting…' : 'Submit review'}
              </button>
              <button
                onClick={() => { setShowReview(false); setReviewError('') }}
                className="rounded-lg border border-forest-green/20 px-5 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-cream transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Report modal ─────────────────────────────────────────────────────── */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-cream px-5 py-6 shadow-xl">
            {reportDone ? (
              <div className="py-2 text-center">
                <p className="font-fraunces text-lg font-semibold text-forest-green">
                  Thanks — I read every report and I&rsquo;ll take a look.
                </p>
                <button
                  onClick={() => setShowReport(false)}
                  className="mt-5 rounded-lg bg-forest-green px-5 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <h2 className="font-fraunces text-lg font-semibold text-forest-green">
                  Report this listing
                </h2>
                <p className="mt-1 text-sm font-dm-sans text-forest-green/60">
                  What&rsquo;s wrong with it? This goes straight to me.
                </p>

                <div className="mt-4 space-y-2">
                  {([
                    ['spam', 'Spam'],
                    ['scam', 'Scam / fraud'],
                    ['sold', 'Already sold or expired'],
                    ['inappropriate', 'Offensive / inappropriate'],
                    ['wrong_info', 'Wrong or misleading info'],
                    ['other', 'Something else'],
                  ] as const).map(([value, label]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-dm-sans transition-colors ${
                        reportReason === value
                          ? 'border-forest-green bg-forest-green/5 text-forest-green'
                          : 'border-forest-green/15 text-forest-green/70 hover:border-forest-green/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name="report-reason"
                        value={value}
                        checked={reportReason === value}
                        onChange={() => setReportReason(value)}
                        className="accent-forest-green"
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <textarea
                  value={reportNote}
                  onChange={e => setReportNote(e.target.value)}
                  placeholder="Anything else I should know? (optional)"
                  rows={3}
                  maxLength={2000}
                  className={`${INPUT_CLS} mt-4 resize-none`}
                />

                {reportError && <p className="mt-2 text-sm font-dm-sans text-rust">{reportError}</p>}

                <div className="mt-4 flex gap-3">
                  <button
                    onClick={submitReport}
                    disabled={submittingReport}
                    className="rounded-lg bg-forest-green px-5 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors"
                  >
                    {submittingReport ? 'Sending…' : 'Send report'}
                  </button>
                  <button
                    onClick={() => { setShowReport(false); setReportError('') }}
                    className="rounded-lg border border-forest-green/20 px-5 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-cream transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
