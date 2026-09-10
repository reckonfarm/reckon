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

export type Basemap = 'satellite' | 'street'

export const BASEMAPS: Record<Basemap, {
  url: string
  attribution: string
  maxNativeZoom: number
  maxZoom: number
}> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Imagery &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
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
