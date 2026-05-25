// FSA LFP grazing period presets — sourced from FSA published
// eligibility records. Source year shown per county.
// Dates are MM-DD; applied to the current program year at runtime.
// FSA assigns actual periods at signup — treat as estimates.

export interface GrazingPreset {
  startMMDD: string
  endMMDD:   string
  forageType: string
  sourceYear: number
}

export const GRAZING_PRESETS: Record<string, GrazingPreset> = {
  '30069': { startMMDD: '05-01', endMMDD: '12-01', forageType: 'Native Pasture', sourceYear: 2022 },
  '48011': { startMMDD: '01-01', endMMDD: '12-31', forageType: 'Native Pasture', sourceYear: 2023 },
  '31003': { startMMDD: '04-15', endMMDD: '10-15', forageType: 'Native Pasture', sourceYear: 2025 },
}

export function getGrazingPreset(
  fips: string,
  programYearStartYear: number,
): { startDate: string; endDate: string; forageType: string; sourceYear: number; source: 'county' | 'default' } {
  console.log('[grazing-preset] fips received:', JSON.stringify(fips), 'type:', typeof fips)
  const normalizedFips = String(fips).padStart(5, '0')
  const preset = GRAZING_PRESETS[normalizedFips]
  if (!preset) {
    return {
      startDate:  '',
      endDate:    '',
      forageType: 'Unknown',
      sourceYear: 0,
      source:     'default',
    }
  }
  // If startMMDD is before Oct (month < 10), it falls in the year AFTER program year start
  const startYear = parseInt(preset.startMMDD.slice(0, 2)) < 10
    ? programYearStartYear + 1
    : programYearStartYear
  const endYear = startYear
  return {
    startDate:  `${startYear}-${preset.startMMDD}`,
    endDate:    `${endYear}-${preset.endMMDD}`,
    forageType: preset.forageType,
    sourceYear: preset.sourceYear,
    source:     'county',
  }
}
