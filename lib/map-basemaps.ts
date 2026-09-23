// ─── The two basemaps, in one place ───────────────────────────────────────────
//
// Lifted verbatim out of app/jobs/[id]/JobMapClient.tsx (slice 1) so the
// places draw surface uses the SAME imagery the job map does rather than a
// second copy that drifts. JobMapClient now imports it; nothing about its
// behaviour changed.
//
// Esri World Imagery by default — a rancher reads their own ground from the
// air — with an OSM street fallback (also the lighter option on one bar of
// 3G). maxNativeZoom 17 with maxZoom 19: rural imagery thins out past ~z17,
// so overzoom the native tiles instead of serving gray.
//
// Block 26 — LICENSED imagery. The keyless services.arcgisonline.com endpoint
// is not licensed for commercial use. This is the same picture from
// ibasemaps-api, keyed: the raster source Esri's own keyed `arcgis/imagery`
// style hands a client. (The "Static Basemap Tiles" service has no imagery at
// all — its satellite style is a labels-only overlay.) The attribution is the
// one that style carries, plus Esri's required "Powered by Esri".
//
// NO KEY, NO IMAGERY. There is no fall back to the keyless endpoint: a build
// without the key has no satellite layer, and every map says so in one line
// and draws its shapes on plain ground. ibasemaps answers 200 to a bad key
// too, so a painted tile proves nothing about the licence — usage against the
// key on Esri's dashboard does.

const ESRI_KEY = process.env.NEXT_PUBLIC_ESRI_BASEMAP_KEY ?? ''
/** True when this build was made without ESRI_BASEMAP_KEY. */
export const IMAGERY_KEY_MISSING = ESRI_KEY === ''
/** The one line a map shows where imagery would be. */
export const IMAGERY_KEY_MISSING_LINE = 'Satellite picture is off — the map key is missing from this build.'
/** Plain ground, for when there are no tiles: a missing key, or a dead network. */
export const PLAIN_GROUND = '#FDFBF7'

export type Basemap = 'satellite' | 'street'

export const BASEMAPS: Record<Basemap, {
  url: string
  attribution: string
  maxNativeZoom: number
  maxZoom: number
}> = {
  satellite: {
    url: IMAGERY_KEY_MISSING ? '' : `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${ESRI_KEY}`,
    attribution:
      'Powered by <a href="https://www.esri.com">Esri</a> | Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community',
    maxNativeZoom: 17,
    maxZoom: 19,
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    maxZoom: 19,
  },
}
