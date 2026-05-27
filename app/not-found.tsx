import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <header className="border-b border-forest-green/10">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <Link href="/" className="font-fraunces text-2xl font-bold text-forest-green hover:opacity-80 transition-opacity">
            Reckon
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-forest-green/8 mx-auto">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-forest-green/60">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <h1 className="font-fraunces text-3xl font-semibold text-forest-green mb-3">
            Page not found
          </h1>
          <p className="font-dm-sans text-forest-green/60 mb-6">
            This page does not exist. Search for your county to check drought conditions and FSA program status.
          </p>
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl bg-forest-green px-5 py-2.5 font-dm-sans text-sm font-semibold text-cream hover:bg-forest-green/90 transition-colors">
            Search counties
          </Link>
        </div>
      </main>
    </div>
  )
}
