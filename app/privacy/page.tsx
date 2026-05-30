import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import SiteHeader from '@/app/components/SiteHeader'
import { renderMarkdown } from '@/lib/markdown'

export const metadata: Metadata = { title: 'Privacy Policy' }

// Renders content/privacy-policy.md at build time. Editing the markdown is the
// only change needed to update this page — the copy is not hardcoded here.
export default async function PrivacyPage() {
  let md: string
  try {
    md = await readFile(path.join(process.cwd(), 'content', 'privacy-policy.md'), 'utf8')
  } catch {
    // File not present yet — render a placeholder rather than fail the build.
    // Drop content/privacy-policy.md in and the real policy renders on next build.
    md = '# Privacy Policy\n\n_Coming soon._\n\nOur Privacy Policy is being finalized and will appear here shortly.'
  }
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <article className="pb-16">{renderMarkdown(md)}</article>
      </main>
    </>
  )
}
