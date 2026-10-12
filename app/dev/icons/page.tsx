import type { Metadata } from 'next'

// ─── /dev/icons — pick the home-screen icon once (Block 48) ──────────────────
// iOS keeps a home-screen icon until the app is re-added, so the switch is
// made once, by PK, from this page on his phone. Each candidate is painted at
// the four sizes iOS uses — 180 (home screen @3x), 120 (@2x), 60 (1x, the
// size the eye sees), 29 (Settings) — beside a stand-in Messages and Weather
// so it is judged next to what it will live next to. The manifest keeps the
// current icon until he says which.
export const metadata: Metadata = { title: 'Icons', robots: { index: false, follow: false } }

const CANDIDATES = [
  { key: 'current', name: 'Current', src: '/brand/icon-512.png', note: 'What is on phones today' },
  { key: 'rope', name: 'A · Rope', src: '/brand/candidates/rope-512.png', note: 'The rope, twice as thick' },
  { key: 'crest', name: 'B · Crest', src: '/brand/candidates/crest-512.png', note: 'One rise, settles' },
  { key: 'rise', name: 'C · Rise', src: '/brand/candidates/rise-512.png', note: 'One long bend' },
] as const

const SIZES = [180, 120, 60, 29] as const
const CORNER = '22.37%'   // iOS's squircle, near enough

function Messages({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true" style={{ borderRadius: CORNER }}>
      <defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5DF777" /><stop offset="1" stopColor="#0BC227" /></linearGradient></defs>
      <rect width="60" height="60" fill="url(#m)" />
      <path d="M30 13c-10.5 0-19 7-19 15.5 0 4.6 2.5 8.7 6.5 11.5-.3 2.6-1.4 5-3.3 6.9 3.4-.3 6.6-1.6 9.1-3.7 2.1.5 4.3.8 6.7.8 10.5 0 19-7 19-15.5S40.5 13 30 13z" fill="#fff" />
    </svg>
  )
}
function Weather({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true" style={{ borderRadius: CORNER }}>
      <defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4BA3F2" /><stop offset="1" stopColor="#1C6FD6" /></linearGradient></defs>
      <rect width="60" height="60" fill="url(#w)" />
      <circle cx="36" cy="22" r="9" fill="#FFD23F" />
      <path d="M17 42h25a7 7 0 0 0 0-14 9 9 0 0 0-17-2 6.5 6.5 0 0 0-8 6.5A5 5 0 0 0 17 42z" fill="#fff" />
    </svg>
  )
}

export default function IconsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5">
      <h1 className="font-fraunces text-[28px] font-semibold text-ink">Home-screen icon</h1>
      <p className="mt-1 font-dm-sans text-[17px] text-secondary-ink">Pick one. iPhones keep it until the app is added again.</p>
      <div className="mt-6 space-y-6">
        {CANDIDATES.map(c => (
          <section key={c.key} className="rounded-2xl bg-[#3B4A5A] p-4" data-audit={`icon-${c.key}`}>
            <p className="font-dm-sans text-[17px] font-semibold text-white">{c.name} <span className="font-normal text-white/70">· {c.note}</span></p>
            <div className="mt-4 space-y-4">
              {SIZES.map(size => (
                <div key={size} className="flex items-end gap-4 overflow-x-auto">
                  <figure className="flex flex-col items-center gap-1"><Messages size={size} /><figcaption className="font-dm-sans text-[11px] text-white">Messages</figcaption></figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <figure className="flex flex-col items-center gap-1"><img src={c.src} width={size} height={size} alt={`${c.name} at ${size} px`} style={{ width: size, height: size, borderRadius: CORNER }} /><figcaption className="font-dm-sans text-[11px] text-white">Dryline</figcaption></figure>
                  <figure className="flex flex-col items-center gap-1"><Weather size={size} /><figcaption className="font-dm-sans text-[11px] text-white">Weather</figcaption></figure>
                  <p className="pb-5 font-dm-sans text-[13px] text-white/60">{size} px</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
