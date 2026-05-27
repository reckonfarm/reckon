export interface HayCounty {
  id: string
  name: string
  state: string
  lat: number
  lon: number
  fips: string
}

export interface HayListing {
  id: string
  listing_type: string
  hay_type: string | null
  cutting_number: number | null
  bale_type: string | null
  bale_weight_lbs: number | null
  storage_method: string | null
  tonnage: number | null
  price_per_ton: number | null
  contact: string | null
  description: string | null
  haul_radius_miles: number | null
  relief_flag: boolean
  expires_at: string | null
  created_at: string
  hay_test_protein_pct: number | null
  hay_test_tdn_pct: number | null
  hay_test_rfv: number | null
  hay_test_moisture_pct: number | null
  photo_urls: string[]
  mine: boolean
  counties: HayCounty | null
  droughtTier: number | null
}

export interface HayListingDetail extends HayListing {
  seller_since: string | null
  seller_listing_count: number | null
  verified_phone: boolean | null
  display_name: string | null
  seller_avg_rating: number | null
  seller_review_count: number | null
}
