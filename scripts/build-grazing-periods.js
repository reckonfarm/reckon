#!/usr/bin/env node
// Reads /tmp/fsa-lfp-eligibility.csv (FOIA data from Montana Climate Office)
// and outputs lib/grazing-periods.ts with all forage types per 5-digit FIPS county.

const fs = require('fs')
const readline = require('readline')
const path = require('path')

const CSV_PATH = '/tmp/fsa-lfp-eligibility.csv'
const OUTPUT_PATH = path.join(__dirname, '../lib/grazing-periods.ts')

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

      const typesForFips = {}
      for (const [pastureName, { start, end }] of pastures.entries()) {
        typesForFips[pastureName] = {
          start: start.slice(5),  // YYYY-MM-DD → MM-DD
          end:   end.slice(5),
          source: 'FSA',
          year,
        }
      }
      entries[fips] = typesForFips
      break // most recent year only
    }
  }

  // Sort by FIPS as a plain string (leading-zero-safe)
  const sortedEntries = Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  let totalTypes = 0
  const lines = sortedEntries.map(([fips, types]) => {
    const typeLines = Object.entries(types).map(([name, p]) =>
      `    "${name.replace(/"/g, '\\"')}": { start: "${p.start}", end: "${p.end}", source: "FSA", year: ${p.year} },`
    ).join('\n')
    totalTypes += Object.keys(types).length
    return `  "${fips}": {\n${typeLines}\n  },`
  })

  const avgTypes = (totalTypes / sortedEntries.length).toFixed(1)

  const output = `// AUTO-GENERATED — do not edit by hand.
// Source: FOIA-released FSA LFP eligibility data via Montana Climate Office
// Regenerate: node scripts/build-grazing-periods.js
// Counties: ${sortedEntries.length} · Avg forage types per county: ${avgTypes}

export interface GrazingPeriodEntry {
  start:  string   // "MM-DD"
  end:    string   // "MM-DD"
  source: "FSA"
  year:   number
}

export const grazingPeriods: Record<string, Record<string, GrazingPeriodEntry>> = {
${lines.join('\n')}
}

export function getGrazingPeriods(fips: string): Record<string, GrazingPeriodEntry> | null {
  return grazingPeriods[String(fips).padStart(5, '0')] ?? null
}

export function getGrazingPeriod(fips: string, pastureType?: string): GrazingPeriodEntry | null {
  const all = getGrazingPeriods(fips)
  if (!all) return null
  if (pastureType && all[pastureType]) return all[pastureType]
  if (all['Native Pasture']) return all['Native Pasture']
  return Object.values(all)[0] ?? null
}
`

  fs.writeFileSync(OUTPUT_PATH, output, 'utf-8')
  console.log(`Wrote ${sortedEntries.length} counties to ${OUTPUT_PATH}`)
  console.log(`Total forage types: ${totalTypes} · Avg per county: ${avgTypes}`)
}

main().catch(err => { console.error(err); process.exit(1) })
