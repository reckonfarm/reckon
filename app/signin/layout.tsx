import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign In',
  description:
    'Sign in to save your counties and receive drought alerts when LFP tiers trigger.',
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
