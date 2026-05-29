import { test as base, expect, type Page, type TestInfo } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? ''

// Vercel bypass headers — needed on MANUALLY created contexts (newContext),
// which don't inherit the project's use.extraHTTPHeaders.
export function bypassHeaders(): Record<string, string> {
  const b = process.env.VERCEL_BYPASS
  return b ? { 'x-vercel-protection-bypass': b, 'x-vercel-set-bypass-cookie': 'true' } : {}
}

// Options for browser.newContext() in setup + two-account specs.
export function contextOptions(extra: Record<string, unknown> = {}) {
  return { baseURL: BASE, extraHTTPHeaders: bypassHeaders(), ...extra }
}

interface Sink { fatal: string[]; warn: string[] }
const sinks = new WeakMap<Page, Sink>()

// Attach diagnostics to ANY page (used for the default fixture page and for the
// extra pages two-account specs create). FATAL = uncaught pageerror + same-origin
// 5xx. WARN = console.error + requestfailed (logged, never fatal — too noisy:
// map tiles, third-party images, etc.).
export function watchPage(page: Page, label = ''): void {
  const sink: Sink = { fatal: [], warn: [] }
  sinks.set(page, sink)
  const tag = label ? ` ${label}` : ''
  page.on('pageerror', e => sink.fatal.push(`[pageerror${tag}] ${e.message}`))
  page.on('response', r => {
    if (r.status() >= 500 && BASE && r.url().startsWith(BASE)) sink.fatal.push(`[${r.status()}${tag}] ${r.url()}`)
  })
  page.on('console', m => { if (m.type() === 'error') sink.warn.push(`[console.error${tag}] ${m.text()}`) })
  page.on('requestfailed', r => sink.warn.push(`[requestfailed${tag}] ${r.url()} ${r.failure()?.errorText ?? ''}`))
}

export async function assertPageClean(page: Page, testInfo: TestInfo): Promise<void> {
  const sink = sinks.get(page)
  if (!sink) return
  if (sink.warn.length) {
    await testInfo.attach('console-and-network-warnings', { body: sink.warn.join('\n'), contentType: 'text/plain' })
  }
  if (sink.fatal.length) {
    await testInfo.attach('fatal-errors', { body: sink.fatal.join('\n'), contentType: 'text/plain' })
    throw new Error(`Page had fatal errors (pageerror / 5xx):\n${sink.fatal.join('\n')}`)
  }
}

// Full-page screenshot attached to the report under a readable step name.
export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({ fullPage: true })
  await testInfo.attach(name, { body, contentType: 'image/png' })
}

type Fixtures = {
  shot: (name: string) => Promise<void>
}

export const test = base.extend<Fixtures>({
  // Wire diagnostics on the default page; assert clean on teardown.
  page: async ({ page }, use, testInfo) => {
    watchPage(page)
    await use(page)
    await assertPageClean(page, testInfo)
  },
  shot: async ({ page }, use, testInfo) => {
    await use((name: string) => shot(page, testInfo, name))
  },
})

export { expect }
