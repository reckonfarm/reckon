import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Resolved from cwd — the suite is always run from the repo root
// (npm run e2e → playwright test -c e2e/playwright.config.ts).
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const i = trimmed.indexOf('=')
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim()
  }
  return out
}

// Loads ../.env.local (Supabase) + ./.env.e2e (preview URL + bypass) into process.env.
// Idempotent; existing process.env values win (so CI can override).
export function loadEnv(): void {
  const merged = {
    ...parseEnvFile(resolve(process.cwd(), '.env.local')),
    ...parseEnvFile(resolve(process.cwd(), 'e2e/.env.e2e')),
  }
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
}

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}
