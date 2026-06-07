// ─── Official NWS Watch/Warning/Advisory (WWA) color table ─────────────────────
// Generated from the authoritative NWS WWA color list:
//   https://www.weather.gov/media/nws/WWA_Changes_10124.pdf
// 111 products, each keyed by the EXACT `event` string the api.weather.gov alerts
// feed emits (e.g. "Winter Storm Warning", "Red Flag Warning"). `priority` is the
// NWS severity order — LOWER = MORE SEVERE (Tsunami Warning = 1 … Blue Alert = 111).
// This is the mainstream convention every weather app/TV station uses, so a rancher
// reads "pink = winter storm" without a legend. Colors are #RRGGBB, verbatim hex.

export interface NwsAlertStyle {
  color:    string  // #RRGGBB
  priority: number  // lower = more severe
}

// Honest fallback for an event NOT in the table: neutral gray, never red — we never
// paint an unrecognized alert as a tornado warning. priority 999 = below everything,
// so a known alert always wins a dominant-color contest against an unknown one.
export const NWS_UNKNOWN_ALERT_STYLE: NwsAlertStyle = { color: '#9CA3AF', priority: 999 }

// Civil, non-geographic alerts NWS draws transparent (no polygon fill) — surfaced via
// the tap popup only, never painted as a colored region.
export const NON_RENDERING_EVENTS = new Set<string>(['Child Abduction Emergency', 'Blue Alert'])

export const NWS_ALERT_STYLES: Record<string, NwsAlertStyle> = {
  'Tsunami Warning':                  { color: '#FD6347', priority: 1 },
  'Tornado Warning':                  { color: '#FF0000', priority: 2 },
  'Extreme Wind Warning':             { color: '#FF8C00', priority: 3 },
  'Severe Thunderstorm Warning':      { color: '#FFA500', priority: 4 },
  'Flash Flood Warning':              { color: '#8B0000', priority: 5 },
  'Flash Flood Statement':            { color: '#8B0000', priority: 6 },
  'Severe Weather Statement':         { color: '#00FFFF', priority: 7 },
  'Shelter In Place Warning':         { color: '#FA8072', priority: 8 },
  'Evacuation Immediate':             { color: '#7FFF00', priority: 9 },
  'Civil Danger Warning':             { color: '#FFB6C1', priority: 10 },
  'Nuclear Power Plant Warning':      { color: '#4B0082', priority: 11 },
  'Radiological Hazard Warning':      { color: '#4B0082', priority: 12 },
  'Hazardous Materials Warning':      { color: '#4B0082', priority: 13 },
  'Fire Warning':                     { color: '#A0522D', priority: 14 },
  'Civil Emergency Message':          { color: '#FFB6C1', priority: 15 },
  'Law Enforcement Warning':          { color: '#C0C0C0', priority: 16 },
  'Storm Surge Warning':              { color: '#B524F7', priority: 17 },
  'Hurricane Force Wind Warning':     { color: '#CD5C5C', priority: 18 },
  'Hurricane Warning':                { color: '#DC143C', priority: 19 },
  'Typhoon Warning':                  { color: '#DC143C', priority: 20 },
  'Special Marine Warning':           { color: '#FFA500', priority: 21 },
  'Blizzard Warning':                 { color: '#FF4500', priority: 22 },
  'Snow Squall Warning':              { color: '#C71585', priority: 23 },
  'Ice Storm Warning':                { color: '#8B008B', priority: 24 },
  'Heavy Freezing Spray Warning':     { color: '#00BFFF', priority: 25 },
  'Winter Storm Warning':             { color: '#FF69B4', priority: 26 },
  'Lake Effect Snow Warning':         { color: '#008B8B', priority: 27 },
  'Dust Storm Warning':               { color: '#FFE4C4', priority: 28 },
  'Blowing Dust Warning':             { color: '#FFE4C4', priority: 29 },
  'High Wind Warning':                { color: '#DAA520', priority: 30 },
  'Tropical Storm Warning':           { color: '#B22222', priority: 31 },
  'Storm Warning':                    { color: '#9400D3', priority: 32 },
  'Tsunami Advisory':                 { color: '#D2691E', priority: 33 },
  'Tsunami Watch':                    { color: '#FF00FF', priority: 34 },
  'Avalanche Warning':                { color: '#1E90FF', priority: 35 },
  'Earthquake Warning':               { color: '#8B4513', priority: 36 },
  'Volcano Warning':                  { color: '#2F4F4F', priority: 37 },
  'Ashfall Warning':                  { color: '#A9A9A9', priority: 38 },
  'Flood Warning':                    { color: '#00FF00', priority: 39 },
  'Coastal Flood Warning':            { color: '#228B22', priority: 40 },
  'Lakeshore Flood Warning':          { color: '#228B22', priority: 41 },
  'Ashfall Advisory':                 { color: '#696969', priority: 42 },
  'High Surf Warning':                { color: '#228B22', priority: 43 },
  'Excessive Heat Warning':           { color: '#C71585', priority: 44 },
  'Tornado Watch':                    { color: '#FFFF00', priority: 45 },
  'Severe Thunderstorm Watch':        { color: '#DB7093', priority: 46 },
  'Flash Flood Watch':                { color: '#2E8B57', priority: 47 },
  'Gale Warning':                     { color: '#DDA0DD', priority: 48 },
  'Flood Statement':                  { color: '#00FF00', priority: 49 },
  'Extreme Cold Warning':             { color: '#0000FF', priority: 50 },
  'Freeze Warning':                   { color: '#483D8B', priority: 51 },
  'Red Flag Warning':                 { color: '#FF1493', priority: 52 },
  'Storm Surge Watch':                { color: '#DB7FF7', priority: 53 },
  'Hurricane Watch':                  { color: '#FF00FF', priority: 54 },
  'Hurricane Force Wind Watch':       { color: '#9932CC', priority: 55 },
  'Typhoon Watch':                    { color: '#FF00FF', priority: 56 },
  'Tropical Storm Watch':             { color: '#F08080', priority: 57 },
  'Storm Watch':                      { color: '#FFE4B5', priority: 58 },
  'Tropical Cyclone Local Statement': { color: '#FFE4B5', priority: 59 },
  'Winter Weather Advisory':          { color: '#7B68EE', priority: 60 },
  'Avalanche Advisory':               { color: '#CD853F', priority: 61 },
  'Cold Weather Advisory':            { color: '#AFEEEE', priority: 62 },
  'Heat Advisory':                    { color: '#FF7F50', priority: 63 },
  'Flood Advisory':                   { color: '#00FF7F', priority: 64 },
  'Coastal Flood Advisory':           { color: '#7CFC00', priority: 65 },
  'Lakeshore Flood Advisory':         { color: '#7CFC00', priority: 66 },
  'High Surf Advisory':               { color: '#BA55D3', priority: 67 },
  'Dense Fog Advisory':               { color: '#708090', priority: 68 },
  'Dense Smoke Advisory':             { color: '#F0E68C', priority: 69 },
  'Small Craft Advisory':             { color: '#D8BFD8', priority: 70 },
  'Brisk Wind Advisory':              { color: '#D8BFD8', priority: 71 },
  'Hazardous Seas Warning':           { color: '#D8BFD8', priority: 72 },
  'Dust Advisory':                    { color: '#BDB76B', priority: 73 },
  'Blowing Dust Advisory':            { color: '#BDB76B', priority: 74 },
  'Lake Wind Advisory':               { color: '#D2B48C', priority: 75 },
  'Wind Advisory':                    { color: '#D2B48C', priority: 76 },
  'Frost Advisory':                   { color: '#6495ED', priority: 77 },
  'Freezing Fog Advisory':            { color: '#008080', priority: 78 },
  'Freezing Spray Advisory':          { color: '#00BFFF', priority: 79 },
  'Low Water Advisory':               { color: '#A52A2A', priority: 80 },
  'Local Area Emergency':             { color: '#C0C0C0', priority: 81 },
  'Winter Storm Watch':               { color: '#4682B4', priority: 82 },
  'Rip Current Statement':            { color: '#40E0D0', priority: 83 },
  'Beach Hazards Statement':          { color: '#40E0D0', priority: 84 },
  'Gale Watch':                       { color: '#FFC0CB', priority: 85 },
  'Avalanche Watch':                  { color: '#F4A460', priority: 86 },
  'Hazardous Seas Watch':             { color: '#483D8B', priority: 87 },
  'Heavy Freezing Spray Watch':       { color: '#BC8F8F', priority: 88 },
  'Flood Watch':                      { color: '#2E8B57', priority: 89 },
  'Coastal Flood Watch':              { color: '#66CDAA', priority: 90 },
  'Lakeshore Flood Watch':            { color: '#66CDAA', priority: 91 },
  'High Wind Watch':                  { color: '#B8860B', priority: 92 },
  'Excessive Heat Watch':             { color: '#800000', priority: 93 },
  'Extreme Cold Watch':               { color: '#5F9EA0', priority: 94 },
  'Freeze Watch':                     { color: '#00FFFF', priority: 95 },
  'Fire Weather Watch':               { color: '#FFDEAD', priority: 96 },
  'Extreme Fire Danger':              { color: '#E9967A', priority: 97 },
  '911 Telephone Outage':             { color: '#C0C0C0', priority: 98 },
  'Coastal Flood Statement':          { color: '#6B8E23', priority: 99 },
  'Lakeshore Flood Statement':        { color: '#6B8E23', priority: 100 },
  'Special Weather Statement':        { color: '#FFE4B5', priority: 101 },
  'Marine Weather Statement':         { color: '#FFDAB9', priority: 102 },
  'Air Quality Alert':                { color: '#808080', priority: 103 },
  'Air Stagnation Advisory':          { color: '#808080', priority: 104 },
  'Hazardous Weather Outlook':        { color: '#EEE8AA', priority: 105 },
  'Hydrologic Outlook':               { color: '#90EE90', priority: 106 },
  'Short Term Forecast':              { color: '#98FB98', priority: 107 },
  'Administrative Message':           { color: '#C0C0C0', priority: 108 },
  'Test':                             { color: '#F0FFFF', priority: 109 },
  'Child Abduction Emergency':        { color: '#FFFFFF', priority: 110 },
  'Blue Alert':                       { color: '#FFFFFF', priority: 111 },
}

// Resolve one event → its style; unknown events fall to the honest gray (never red).
export function getAlertStyle(event: string): NwsAlertStyle {
  return NWS_ALERT_STYLES[event] ?? NWS_UNKNOWN_ALERT_STYLE
}

// When several alerts overlap, the MOST SEVERE (lowest priority) drives the color.
export function dominantAlertStyle(events: string[]): NwsAlertStyle {
  return events.reduce<NwsAlertStyle>(
    (best, event) => {
      const s = getAlertStyle(event)
      return s.priority < best.priority ? s : best
    },
    NWS_UNKNOWN_ALERT_STYLE,
  )
}
