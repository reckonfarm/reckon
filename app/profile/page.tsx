import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import ProfileForm from './ProfileForm'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">Your profile</h1>
        <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
          This is how buyers and sellers see you on the hay marketplace.
        </p>
        <ProfileForm />
      </main>
    </>
  )
}
