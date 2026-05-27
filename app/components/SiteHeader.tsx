'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

interface Props {
  subtitle?: string
  center?: React.ReactNode
}

export default function SiteHeader({ subtitle, center }: Props) {
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
  }

  return (
    <header className="sticky top-0 z-20 border-b border-forest-green/10 bg-cream/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">

        <Link href="/" className="flex flex-col leading-tight">
          <span className="font-fraunces text-xl font-semibold text-forest-green sm:text-2xl">
            Dryline
          </span>
          {subtitle && (
            <span className="text-xs text-forest-green/50 font-dm-sans">{subtitle}</span>
          )}
        </Link>

        {center && (
          <p className="hidden text-sm text-forest-green/60 font-dm-sans sm:block">
            {center}
          </p>
        )}

        <div className="flex items-center gap-4">
          <Link
            href="/watchlist"
            className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
          >
            My Counties
          </Link>
          <Link
            href="/hay"
            className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
          >
            Hay
          </Link>

          {user ? (
            <>
              <span className="hidden max-w-[160px] truncate text-xs text-forest-green/40 font-dm-sans sm:block">
                {user.email}
              </span>
              <button
                onClick={signOut}
                className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/signin"
              className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-sm font-medium text-forest-green hover:bg-forest-green/5 transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>

      </div>
    </header>
  )
}
