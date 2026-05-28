import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'

const DROUGHT_BADGE: Record<number, { label: string; cls: string }> = {
  1: { label: 'D1', cls: 'bg-yellow-100 text-yellow-800 ring-yellow-200' },
  2: { label: 'D2', cls: 'bg-orange-100 text-orange-800 ring-orange-200' },
  3: { label: 'D3', cls: 'bg-red-100 text-red-700 ring-red-200' },
  4: { label: 'D4', cls: 'bg-red-200 text-red-900 ring-red-300' },
}

const BALE_TYPE_LABELS: Record<string, string> = {
  large_round:      'Large Round',
  small_round:      'Small Round',
  small_square:     'Small Square',
  '3string_square': '3-String Square',
  '4string_square': '4-String Square',
}

const ORDINALS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' }

interface CountyRow {
  id:    number
  fips:  string
  name:  string
  state: string
}

interface ListingRow {
  id:             number
  listing_type:   string
  hay_type:       string | null
  cutting_number: number | null
  bale_type:      string | null
  tonnage:        number | null
  price_per_ton:  number | null
  storage_method: string | null
  relief_flag:    boolean
  description:    string | null
  photo_urls:     string[] | null
  created_at:     string
  counties:       CountyRow | null
}

interface ProfileRow {
  id:                  string
  display_name:        string | null
  bio:                 string | null
  operation_type:      string | null
  region:              string | null
  verified_phone:      boolean | null
  total_sales:         number | null
  seller_avg_rating:   number | null
  seller_review_count: number | null
}

function renderStars(avg: number): string {
  const n = Math.round(avg)
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

export default async function SellerPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = createServiceClient()

  const { data: profile } = await db
    .from('profiles')
    .select('id, display_name, bio, operation_type, region, verified_phone, total_sales, seller_avg_rating, seller_review_count')
    .eq('id', id)
    .maybeSingle<ProfileRow>()

  if (!profile) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 text-center">
          <p className="font-fraunces text-xl font-semibold text-forest-green">Seller not found</p>
          <p className="mt-2 text-sm text-forest-green/60 font-dm-sans">
            This seller profile doesn&apos;t exist or has been removed.
          </p>
          <Link href="/hay" className="mt-4 inline-block text-sm font-dm-sans font-medium text-forest-green underline hover:text-forest-green/70">
            ← Back to Hay Network
          </Link>
        </main>
      </>
    )
  }

  const { data: listingsData } = await db
    .from('hay_listings')
    .select('id, listing_type, hay_type, cutting_number, bale_type, tonnage, price_per_ton, storage_method, relief_flag, description, photo_urls, created_at, counties(id, fips, name, state)')
    .eq('user_id', id)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  const listings = (listingsData ?? []) as unknown as ListingRow[]

  // Drought tier (highest D1–D4 with coverage > 0) per listing county
  const tierByCounty: Record<number, number> = {}
  const countyIds = [...new Set(listings.map(l => l.counties?.id).filter((v): v is number => v != null))]
  if (countyIds.length > 0) {
    const { data: latest } = await db
      .from('drought_data')
      .select('week_date')
      .order('week_date', { ascending: false })
      .limit(1)
      .single()
    if (latest) {
      const { data: droughtRows } = await db
        .from('drought_data')
        .select('county_id, d1, d2, d3, d4')
        .in('county_id', countyIds)
        .eq('week_date', latest.week_date)
      for (const d of droughtRows ?? []) {
        for (let i = 4; i >= 1; i--) {
          const key = `d${i}` as 'd1' | 'd2' | 'd3' | 'd4'
          if ((d[key] ?? 0) > 0) { tierByCounty[d.county_id] = i; break }
        }
      }
    }
  }

  const name = profile.display_name ?? 'Dryline Member'

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">

        <Link
          href="/hay"
          className="inline-flex items-center gap-1 text-sm font-dm-sans text-forest-green/60 hover:text-forest-green transition-colors mb-6"
        >
          ← Back to Hay Network
        </Link>

        {/* Seller header */}
        <div className="rounded-xl border border-forest-green/10 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">{name}</h1>
            {profile.verified_phone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-green-700 ring-1 ring-green-200">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Phone verified
              </span>
            )}
          </div>

          {(profile.operation_type || profile.region) && (
            <p className="mt-1 text-sm font-dm-sans text-forest-green/60">
              {[profile.operation_type, profile.region].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Rating + sales */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-dm-sans text-sm">
            {(profile.seller_review_count ?? 0) > 0 ? (
              <span className="text-forest-green/80">
                {renderStars(profile.seller_avg_rating ?? 0)}
                <span className="ml-1 text-forest-green/50">
                  ({profile.seller_review_count} review{profile.seller_review_count === 1 ? '' : 's'})
                </span>
              </span>
            ) : (
              <span className="text-forest-green/40">No reviews yet</span>
            )}
            {(profile.total_sales ?? 0) > 0 && (
              <span className="text-forest-green/50">
                {profile.total_sales} sale{profile.total_sales === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {profile.bio && (
            <p className="mt-4 text-sm font-dm-sans text-forest-green/80 leading-relaxed whitespace-pre-wrap">
              {profile.bio}
            </p>
          )}
        </div>

        {/* Active listings */}
        <h2 className="mt-8 mb-4 font-fraunces text-lg font-semibold text-forest-green">
          Active listings{listings.length > 0 ? ` (${listings.length})` : ''}
        </h2>

        {listings.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-forest-green/20 bg-white px-6 py-12 text-center">
            <p className="font-dm-sans text-sm text-forest-green/50">
              This seller has no active listings right now.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {listings.map(l => {
              const county = l.counties
              const tier = county?.id != null ? tierByCounty[county.id] ?? null : null
              const badge = tier !== null ? DROUGHT_BADGE[tier] : null
              const priceLabel =
                l.listing_type === 'donate'
                  ? 'Donation'
                  : l.price_per_ton != null
                    ? `$${l.price_per_ton.toFixed(0)}/ton`
                    : 'Price TBD'

              return (
                <li key={l.id} className="rounded-xl border border-forest-green/10 bg-white shadow-sm">
                  <Link href={`/hay/${l.id}`} className="block">
                    {l.photo_urls && l.photo_urls.length > 0 && (
                      <div className="relative h-32 w-full overflow-hidden rounded-t-xl">
                        <img
                          src={l.photo_urls[0]}
                          alt={`${l.hay_type ?? 'Hay'} listing photo`}
                          className="h-full w-full object-cover"
                        />
                        {l.photo_urls.length > 1 && (
                          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/50 px-1.5 py-0.5 font-dm-sans text-[10px] text-white">
                            +{l.photo_urls.length - 1} more
                          </span>
                        )}
                      </div>
                    )}
                    <div className="px-4 py-4 sm:px-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-fraunces text-base font-semibold text-forest-green">
                          {l.hay_type}
                          {l.cutting_number != null && (
                            <span className="font-dm-sans text-sm font-normal text-forest-green/60 ml-1">
                              — {ORDINALS[l.cutting_number]} cut
                            </span>
                          )}
                        </h3>
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
                        {l.bale_type && (
                          <span className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green/70 ring-1 ring-forest-green/15">
                            {BALE_TYPE_LABELS[l.bale_type] ?? l.bale_type}
                          </span>
                        )}
                        {badge && (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-dm-sans ring-1 ${badge.cls}`}>
                            {badge.label} Drought
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-sm text-forest-green/60 font-dm-sans">
                        {county?.name}, {county?.state}
                      </p>

                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-forest-green/50 font-dm-sans">
                        <span>{priceLabel}</span>
                        {l.tonnage != null && <span>{l.tonnage} tons</span>}
                      </div>

                      {l.description && (
                        <p className="mt-2 text-sm text-forest-green/70 font-dm-sans line-clamp-2">
                          {l.description}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

      </main>
    </>
  )
}
