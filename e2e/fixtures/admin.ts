import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

// Service-role admin client (talks to Supabase directly — NOT through the preview,
// so no Vercel bypass needed). Used for createUser / generateLink / deleteUser.
export function adminClient(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export interface TestUser { email: string; id: string }

// Create (idempotent) a confirmed test user and return its id.
export async function ensureUser(email: string): Promise<TestUser> {
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (data?.user) return { email, id: data.user.id }
  // Already exists → look it up by listing (small project; page through if needed).
  if (error && /already/i.test(error.message)) {
    for (let page = 1; page <= 20; page++) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      const found = list?.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
      if (found) return { email, id: found.id }
      if (!list || list.users.length < 200) break
    }
  }
  throw new Error(`ensureUser failed for ${email}: ${error?.message ?? 'not found'}`)
}

// Generate a magic-link token_hash for programmatic sign-in via /auth/callback.
export async function magicTokenHash(email: string): Promise<string> {
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const hash = data?.properties?.hashed_token
  if (error || !hash) throw new Error(`generateLink failed for ${email}: ${error?.message ?? 'no token'}`)
  return hash
}

// Generate the 6-digit email OTP (for exercising the real sign-in form in one spec).
export async function emailOtp(email: string): Promise<string> {
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const otp = data?.properties?.email_otp
  if (error || !otp) throw new Error(`generateLink(email_otp) failed for ${email}: ${error?.message ?? 'no otp'}`)
  return otp
}

export async function deleteUser(id: string): Promise<void> {
  const admin = adminClient()
  await admin.auth.admin.deleteUser(id).catch(() => {})
}
