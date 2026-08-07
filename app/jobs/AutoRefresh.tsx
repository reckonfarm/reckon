'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Silent server-data refresh for live watching (the cab use case: the cron
// re-derives every few minutes while a machine works, and the open page should
// grow without a manual reload). router.refresh() re-fetches the server
// component payload in place — no navigation, so it's safe in the iOS
// standalone PWA (the known bug there is dropped router.PUSH, not refresh).
// Skips ticks while the tab is hidden and refreshes immediately on return.
export default function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const id = setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [router, intervalMs])

  return null
}
