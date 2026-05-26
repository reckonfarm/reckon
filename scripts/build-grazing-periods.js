#!/usr/bin/env node
// Reads /tmp/fsa-lfp-eligibility.csv (FOIA data from Montana Climate Office)
// and outputs lib/grazing-periods.ts with one entry per 5-digit FIPS county.

const fs = require('fs')
const readline = require('readline')
const path = require('path')

const CSV_PATH = '/tmp/fsa-lfp-eligibility.csv'
const OUTPUT_PATH = path.join(__dirname, '../lib/grazing-periods.ts')

const PASTURE_PRIORITY = ['Native Pasture', 'Full Season Improved Pasture']

function parseCSVLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

async function main() {
  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH),
    crlfDelay: Infinity,
  })

  // fips -> Map<year, Map<pastureName, { start, end }>>
  const byFips = new Map()
  let isHeader = true

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^﻿/, '') // strip BOM on first line
    const cols = parseCSVLine(line)

    if (isHeader) {
      isHeader = false
      continue
    }

    const fipsState  = String(cols[0]).padStart(2, '0')
    const fipsCounty = String(cols[1]).padStart(3, '0')
    const fips       = fipsState + fipsCounty
    const year       = parseInt(cols[9], 10)
    const pasture    = cols[10]
    const startDate  = cols[24]
    const endDate    = cols[25]

    if (!startDate || startDate === 'NA' || !endDate || endDate === 'NA') continue
    if (isNaN(year)) continue

    if (!byFips.has(fips)) byFips.set(fips, new Map())
    const byYear = byFips.get(fips)
    if (!byYear.has(year)) byYear.set(year, new Map())
    byYear.get(year).set(pasture, { start: startDate, end: endDate })
  }

  const entries = {}

  for (const [fips, byYear] of byFips.entries()) {
    const years = [...byYear.keys()].sort((a, b) => b - a) // descending

    for (const year of years) {
      const pastures = byYear.get(year)
      if (pastures.size === 0) continue

      let chosenName = null
      for (const priority of PASTURE_PRIORITY) {
        if (pastures.has(priority)) { chosenName = priority; break }
      }
      if (!chosenName) {
        chosenName = [...pastures.keys()][0]
      }

      const { start, end } = pastures.get(chosenName)
      entries[fips] = {
        start:   start.slice(5),  // YYYY-MM-DD → MM-DD
        end:     end.slice(5),
        pasture: chosenName,
        source:  'FSA',
        year,
      }
      break // most recent year only
    }
  }

  // Sort by FIPS as a plain string (leading-zero-safe) — avoid JS integer key reordering
  const sortedEntries = Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const lines = sortedEntries.map(([fips, p]) =>
    `  "${fips}": { start: "${p.start}", end: "${p.end}", pasture: "${p.pasture.replace(/"/g, '\\"')}", source: "FSA", year: ${p.year} },`
  )

  const output = `// AUTO-GENERATED — do not edit by hand.
// Source: FOIA-released FSA LFP eligibility data via Montana Climate Office
// Regenerate: node scripts/build-grazing-periods.js
// Counties: ${sortedEntries.length}

export interface GrazingPeriod {
  start: string   // "MM-DD"
  end: string     // "MM-DD"
  pasture: string
  source: "FSA"
  year: number    // most recent program year with valid data
}

export const grazingPeriods: Record<string, GrazingPeriod> = {
${lines.join('\n')}
}

export function getGrazingPeriod(fips: string): GrazingPeriod | null {
  return grazingPeriods[String(fips).padStart(5, '0')] ?? null
}
`

  fs.writeFileSync(OUTPUT_PATH, output, 'utf-8')
  console.log(`Wrote ${sortedEntries.length} counties to ${OUTPUT_PATH}`)
}

main().catch(err => { console.error(err); process.exit(1) })
