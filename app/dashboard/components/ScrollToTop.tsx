'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

export default function ScrollToTop() {
  const searchParams = useSearchParams()
  const fips = searchParams.get('fips')

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [fips])

  return null
}
