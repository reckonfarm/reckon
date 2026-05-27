'use client'

import Link from 'next/link'

export default function Error({
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <header className="border-b border-forest-green/10">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <Link href="/" className="font-fraunces text-2xl font-bold text-forest-green hover:opacity-80 transition-opacity">
            Dryline
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-rust/10 mx-auto">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-rust">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <h1 className="font-fraunces text-3xl font-semibold text-forest-green mb-3">
            Something went wrong
          </h1>
          <p className="font-dm-sans text-forest-green/60 mb-6">
            We could not load the data. This may be a temporary issue with a data source.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={reset} className="inline-flex items-center gap-2 rounded-xl bg-forest-green px-5 py-2.5 font-dm-sans text-sm font-semibold text-cream hover:bg-forest-green/90 transition-colors">
              Try again
            </button>
            <Link href="/" className="inline-flex items-center gap-2 rounded-xl border border-forest-green/20 px-5 py-2.5 font-dm-sans text-sm font-semibold text-forest-green hover:bg-forest-green/5 transition-colors">
              Go home
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
