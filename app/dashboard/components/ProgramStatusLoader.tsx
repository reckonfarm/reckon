'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'

// ProgramStatus (the "Eligibility math" panel) statically imports the
// 2,691-county grazing-period table — lib/grazing-periods.ts, 820 KB raw — for
// its pasture-type picker, which put that table in the dashboard's eager
// first-load JavaScript for every visitor, though the panel only ever mounts
// when the accordion is opened. This loader moves ProgramStatus (and the table
// with it) into its own chunk, fetched on first mount.
//
// It has to be a CLIENT component: next/dynamic from a Server Component does
// not code-split a Client Component (Next's lazy-loading guide). SSR stays on
// — the panel renders on the server today when the accordion is open, and
// nothing visual changes; only the JavaScript delivery moves.
const ProgramStatus = dynamic(() => import('./ProgramStatus'), {
  loading: () => (
    <div aria-hidden="true" className="h-40 rounded-xl border border-forest-green/10 bg-white" />
  ),
})

type Props = ComponentProps<typeof import('./ProgramStatus').default>

export default function ProgramStatusLoader(props: Props) {
  return <ProgramStatus {...props} />
}
