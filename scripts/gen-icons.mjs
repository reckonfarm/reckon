// Generates the Dryline app-icon assets by rasterizing an SVG of the mark with
// sharp (correct color + serif text rendering). Run:  node scripts/gen-icons.mjs
//
// The mark: forest-green rounded field (#1B4332), cream serif "D" (#FDFBF7) at
// ~70% cap height, rust "dryline" bar (#8B3A2B) crossing under the D's midline.
// Also writes the SVG master (public/icon.svg) so source + rasters never drift.
//
// Outputs into /public: icon.svg, icon-512.png, icon-192.png,
// apple-touch-icon.png (180, full-bleed OPAQUE square — iOS rounds it),
// favicon-32.png, favicon.ico.

import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const FIELD = '#1B4332'
const CREAM = '#FDFBF7'
const RUST = '#8B3A2B'

// All geometry in a 512 viewBox; sharp resizes vectors crisply to any size.
//  rounded=true  → rounded field with transparent corners (PWA tiles, favicon)
//  rounded=false → full-bleed square (apple-touch; alpha removed after raster)
function svg({ rounded }) {
  const rx = rounded ? 115 : 0 // ~22% corner radius
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rx}" fill="${FIELD}"/>
  <text x="256" y="256" text-anchor="middle" dominant-baseline="central"
        font-family="Georgia, 'Times New Roman', 'Fraunces', serif" font-weight="600"
        font-size="510" fill="${CREAM}" stroke="${CREAM}" stroke-width="3">D</text>
  <rect x="92" y="368.5" width="328" height="11" rx="5.5" fill="${RUST}"/>
</svg>`
}

const roundedSvg = svg({ rounded: true })
const squareSvg = svg({ rounded: false })

async function rasterRounded(size) {
  return sharp(Buffer.from(roundedSvg), { density: 384 }).resize(size, size).png().toBuffer()
}
async function rasterSquareOpaque(size) {
  // Full-bleed, no transparency — iOS apple-touch requirement.
  return sharp(Buffer.from(squareSvg), { density: 384 })
    .resize(size, size)
    .flatten({ background: FIELD })
    .removeAlpha()
    .png()
    .toBuffer()
}

// Minimal ICO wrapping a single PNG entry (valid for modern browsers).
function pngToIco(pngBuf, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size >= 256 ? 0 : size, 0)
  entry.writeUInt8(size >= 256 ? 0 : size, 1)
  entry.writeUInt8(0, 2)
  entry.writeUInt8(0, 3)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(pngBuf.length, 8)
  entry.writeUInt32LE(6 + 16, 12)
  return Buffer.concat([header, entry, pngBuf])
}

const out = (name, buf) => { writeFileSync(join(PUBLIC, name), buf); console.log(`  ${name}  (${buf.length} bytes)`) }

console.log('Generating Dryline icons into /public:')
out('icon.svg', Buffer.from(roundedSvg))
out('icon-512.png', await rasterRounded(512))
out('icon-192.png', await rasterRounded(192))
out('apple-touch-icon.png', await rasterSquareOpaque(180))
const fav32 = await rasterRounded(32)
out('favicon-32.png', fav32)
out('favicon.ico', pngToIco(fav32, 32))
console.log('Done.')
