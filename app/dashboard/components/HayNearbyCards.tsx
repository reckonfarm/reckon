import Link from 'next/link'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'

// Server-rendered nearest-hay cards for the dashboard Hay view. Buyer-facing,
// sell-only, ranked by road miles from the home county — a compact doorway into
// the full marketplace. The markup/quality-badge pattern deliberately mirrors the
// /hay listing card (app/hay/page.tsx) so the two doorways read as one product;
// the seller-only controls (edit/remove, staleness nudge, trust strip) are omitted
// since this is a read-only ranked teaser. Each card links to the existing detail
// page, carrying deliverTo so the delivered-cost math lands the same as a tap from /hay.

// Mirrors of the small label maps in app/hay/page.tsx (that file is a client page,
// so the constants can't be imported — kept in sync by hand, intentionally tiny).
const DROUGHT_BADGE: Record<number, { label: string; cls: string }> = {
  1: { label: 'D1', cls: 'bg-yellow-100 text-yellow-800 ring-yellow-200' },
  2: { label: 'D2', cls: 'bg-orange-100 text-orange-800 ring-orange-200' },
  3: { label: 'D3', cls: 'bg-red-100 text-red-700 ring-red-200' },
  4: { label: 'D4', cls: 'bg-red-200 text-red-900 ring-red-300' },
}

const BALE_TYPE_LABELS: Record<string, string> = {
  small_square_2string: 'Small Square (2-string)',
  small_square_3string: 'Small Square (3-string)',
  large_square_3x3:     'Large Square (3x3)',
  large_square_3x4:     'Large Square (3x4)',
  large_square_4x4:     'Large Square (4x4)',
  round_4x4:            'Round (4x4)',
  round_5x6:            'Round (5x6)',
  large_round:      'Round (5x6)',
  small_round:      'Round (4x4)',
  small_square:     'Small Square (2-string)',
  '3string_square': 'Small Square (3-string)',
  '4string_square': 'Small Square (3-string)',
}

const ORDINALS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' }

export interface NearbyHayCard {
  id:              string
  hayType:         string | null
  cuttingNumber:   number | null
  baleType:        string | null
  storageMethod:   string | null
  tonnage:         number | null
  pricePerTon:     number | null
  haulRadiusMiles: number | null
  reliefFlag:      boolean
  hasTest:         boolean
  photoUrls:       string[]
  description:     string | null
  countyName:      string
  state:           string
  miles:           number
  droughtTier:     number | null
  // Delivered-cost headline (sell + priced + coords). Null → show listing price only.
  delivered:       { delivered: number; base: number; freightPerTon: number; miles: number } | null
}

export default function HayNearbyCards({
  listings,
  deliverToFips,
}: {
  listings: NearbyHayCard[]
  deliverToFips: string
}) {
  // Honest empty state — never pad, never fake a card.
  if (listings.length === 0) {
    return (
      <Card shadow="none" className="px-6 py-8 text-center">
        <p className="text-sm text-forest-green/60 font-dm-sans">
          No hay for sale listed near you yet.
        </p>
      </Card>
    )
  }

  return (
    <ul className="space-y-3">
      {listings.map(l => {
        const dc = l.delivered
        const badge = l.droughtTier !== null ? DROUGHT_BADGE[l.droughtTier] : null
        const priceLabel =
          l.pricePerTon != null ? `$${l.pricePerTon.toFixed(0)}/ton` : 'Price TBD'

        return (
          <Card
            as={Link}
            key={l.id}
            href={`/hay/${l.id}?deliverTo=${deliverToFips}`}
            className="block cursor-pointer transition-colors hover:bg-forest-green/[0.02]"
          >
            {l.photoUrls.length > 0 && (
              <div className="relative h-32 w-full overflow-hidden rounded-t-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={l.photoUrls[0]}
                  alt={`${l.hayType ?? 'Hay'} listing photo`}
                  className="h-full w-full object-cover"
                />
                {l.photoUrls.length > 1 && (
                  <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/50 px-1.5 py-0.5 font-dm-sans text-xs text-white">
                    +{l.photoUrls.length - 1} more
                  </span>
                )}
              </div>
            )}

            <div className="px-4 py-4 sm:px-5">
              {/* Title + quality badges */}
              <div className="flex flex-wrap items-center gap-2">
                <Heading level={5}>
                  {l.hayType ?? 'Hay'}
                  {l.cuttingNumber != null && (
                    <span className="font-dm-sans text-sm font-normal text-forest-green/60 ml-1">
                      — {ORDINALS[l.cuttingNumber]} cut
                    </span>
                  )}
                </Heading>
                {l.reliefFlag && (
                  <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-red-700 ring-1 ring-red-200">
                    Relief
                  </span>
                )}
                {l.baleType && (
                  <span className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green/70 ring-1 ring-forest-green/15">
                    {BALE_TYPE_LABELS[l.baleType] ?? l.baleType}
                  </span>
                )}
                {l.storageMethod === 'barn' && (
                  <span className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green/70 ring-1 ring-forest-green/15">
                    Barn stored
                  </span>
                )}
                {l.storageMethod === 'covered' && (
                  <span className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green/70 ring-1 ring-forest-green/15">
                    Covered
                  </span>
                )}
                {l.hasTest && (
                  <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-green-700 ring-1 ring-green-200">
                    Hay test
                  </span>
                )}
                {badge && (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-dm-sans ring-1 ${badge.cls}`}>
                    {badge.label} Drought
                  </span>
                )}
              </div>

              {/* Location + distance (always shown — this is the ranking signal) */}
              <p className="mt-1 text-sm text-forest-green/60 font-dm-sans">
                {l.countyName}, {l.state}
                <span className="ml-1 text-forest-green/40">· {l.miles} mi away</span>
              </p>

              {/* Price — delivered headline (we always know the home county here) */}
              {dc ? (
                <div className="mt-1.5">
                  <p className="font-fraunces text-xl font-semibold text-forest-green leading-none">
                    ${dc.delivered}
                    <span className="ml-1 font-dm-sans text-xs font-medium text-forest-green/60">/ton est. delivered</span>
                  </p>
                  <p className="mt-1 text-xs text-forest-green/50 font-dm-sans">
                    ${dc.base}/ton hay + ~${dc.freightPerTon}/ton est. freight · ~{dc.miles} mi
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 font-fraunces text-base font-semibold text-forest-green">
                  {priceLabel}
                </p>
              )}

              {/* Meta row */}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-forest-green/50 font-dm-sans">
                {l.tonnage != null && <span>{l.tonnage} tons</span>}
                {l.haulRadiusMiles != null && <span>Hauls up to {l.haulRadiusMiles} mi</span>}
              </div>

              {l.description && (
                <p className="mt-2 text-sm text-forest-green/70 font-dm-sans line-clamp-2">
                  {l.description}
                </p>
              )}
            </div>
          </Card>
        )
      })}
    </ul>
  )
}
