// ─── The pictures in the home-screen walkthrough ─────────────────────────────
// Drawn once, used by the Account line (InstallLine) and the nudge
// (InstallNudge): iOS's Share box-and-arrow, the Add to Home Screen plus-box,
// and Chrome's three-dot menu. 56 px, the same size as the button beside them.
const frame = 'shrink-0 rounded-xl border border-forest-green/15 bg-white'

export const Share = () => (
  <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className={frame}>
    <g fill="none" stroke="#1B4332" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M28 33V13" /><path d="M21 20l7-7 7 7" /><path d="M19 26h-3v17h24V26h-3" />
    </g>
  </svg>
)
export const AddToHome = () => (
  <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className={frame}>
    <g fill="none" stroke="#1B4332" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="13" y="13" width="30" height="30" rx="6" /><path d="M28 21v14" /><path d="M21 28h14" />
    </g>
  </svg>
)
export const Menu = () => (
  <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className={frame}>
    <g fill="#1B4332"><circle cx="28" cy="17" r="3" /><circle cx="28" cy="28" r="3" /><circle cx="28" cy="39" r="3" /></g>
  </svg>
)

const step = 'flex items-center gap-4'
const words = 'font-dm-sans text-[17px] text-ink'

/** Share → Add to Home Screen → Add. */
export const IosSteps = ({ audit }: { audit: string }) => (
  <ol className="space-y-4" data-audit={audit}>
    <li className={step}><Share /><p className={words}><span className="font-semibold">1.</span> Tap <span className="font-semibold">Share</span> at the bottom of Safari.</p></li>
    <li className={step}><AddToHome /><p className={words}><span className="font-semibold">2.</span> Scroll down and tap <span className="font-semibold">Add to Home Screen</span>.</p></li>
    <li className={step}><div className="h-14 w-14 shrink-0" /><p className={words}><span className="font-semibold">3.</span> Tap <span className="font-semibold">Add</span>. Dryline is on your home screen.</p></li>
  </ol>
)

/** Chrome's menu, when the browser offered no prompt of its own. */
export const AndroidSteps = ({ audit }: { audit: string }) => (
  <ol className="space-y-4" data-audit={audit}>
    <li className={step}><Menu /><p className={words}><span className="font-semibold">1.</span> Tap the <span className="font-semibold">⋮ menu</span> at the top of Chrome.</p></li>
    <li className={step}><AddToHome /><p className={words}><span className="font-semibold">2.</span> Tap <span className="font-semibold">Add to Home screen</span> or <span className="font-semibold">Install app</span>.</p></li>
    <li className={step}><div className="h-14 w-14 shrink-0" /><p className={words}><span className="font-semibold">3.</span> Tap <span className="font-semibold">Install</span>. Dryline is on your home screen.</p></li>
  </ol>
)
