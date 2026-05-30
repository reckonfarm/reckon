import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import SiteHeader from '@/app/components/SiteHeader'
import { renderMarkdown } from '@/lib/markdown'

export const metadata: Metadata = { title: 'Terms of Service' }

// Renders content/terms-of-service.md at build time. Editing the markdown is the
// only change needed to update this page — the copy is not hardcoded here.
export default async function TermsPage() {
  let md: string
  try {
    md = await readFile(path.join(process.cwd(), 'content', 'terms-of-service.md'), 'utf8')
  } catch {
    // File not present yet — render a placeholder rather than fail the build.
    // Drop content/terms-of-service.md in and the real terms render on next build.
    md = '# Terms of Service\n\n_Coming soon._\n\nOur Terms of Service are being finalized and will appear here shortly.'
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
