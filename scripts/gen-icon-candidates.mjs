// ─── Home-screen icon candidates + the maskable icon (Block 48) ──────────────
//   node scripts/gen-icon-candidates.mjs
//
// Writes, into public/brand:
//   icon-512-maskable.png        the CURRENT rope mark, shrunk to the 80% safe
//                                zone on the forest tile — the manifest's
//                                maskable entry; the `any` icons are untouched.
//   candidates/{rope,crest,rise}-512.png   three bold variants for /dev/icons:
//                                solid forest #1B4332, thick cream #FDFBF7
//                                stroke, no fine detail. The manifest keeps the
//                                current icon until PK picks one.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND = join(ROOT, 'public', 'brand')
const OUT = join(BRAND, 'candidates')
mkdirSync(OUT, { recursive: true })

const FOREST = '#1B4332'
const CREAM = '#FDFBF7'

// Each path sits inside the central 80% (x,y 51…461 of 512) so a round or
// squircle mask never clips it. Stroke widths are 9–11% of the tile: at 29 px
// (Settings) that is still three pixels of cream.
const CANDIDATES = {
  // The rope as it is today — one crest, one trough — twice as thick.
  rope: { stroke: 46, d: 'M62 256 L130 256 C184 256 190 150 236 150 C286 150 284 362 334 362 C382 362 386 256 430 256 L450 256' },
  // One crest only: the line rises, peaks, and settles. Reads as ground.
  crest: { stroke: 52, d: 'M62 322 L128 322 C196 322 204 178 256 178 C308 178 316 322 384 322 L450 322' },
  // One long rise with a single bend — a dryline on a weather map.
  rise: { stroke: 56, d: 'M66 368 C230 368 260 144 446 144' },
}

const tile = (d, stroke) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${FOREST}"/>
  <path d="${d}" fill="none" stroke="${CREAM}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

const png = async (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).flatten({ background: FOREST }).removeAlpha().png().toBuffer()
const out = (path, buf) => { writeFileSync(path, buf); console.log(`  ${path.replace(ROOT + '/', '')}  (${buf.length} bytes)`) }

console.log('Icon candidates:')
for (const [name, { d, stroke }] of Object.entries(CANDIDATES)) {
  out(join(OUT, `${name}-512.png`), await png(tile(d, stroke), 512))
}

// The maskable icon: the current icon-512.png, its art scaled to 400 px (78%
// of the tile, inside the 80% safe zone) on a fresh forest tile.
const current = await sharp(join(BRAND, 'icon-512.png')).resize(400, 400).png().toBuffer()
const maskable = await sharp({ create: { width: 512, height: 512, channels: 3, background: FOREST } })
  .composite([{ input: current, left: 56, top: 56 }]).png().toBuffer()
out(join(BRAND, 'icon-512-maskable.png'), maskable)
console.log('Done.')
