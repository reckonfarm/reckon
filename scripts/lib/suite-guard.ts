import { existsSync, statSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

// ─── Suite precondition: run from a worktree, and say what you are running ────
// Block 7 (PK): the suite worktree was removed at Block 6 close, and the next
// runs silently executed against whatever branch the main tree held — a bad
// run and a debug cycle. A suite now refuses to start from the main tree
// unless SUITE_ALLOW_MAIN_TREE=1 is set on purpose, and every run prints the
// ref it is running so the log carries its own identity.
//   scripts/suite-worktree.sh <ref>      creates or refreshes ~/reckon-wt at <ref>, detached
//   cd ~/reckon-wt && npx tsx scripts/<suite>.ts
/**
 * DOCTRINE (PK, 2026-09-18): A CHECK PROVES WHAT IT IS LOOKING AT BEFORE IT
 * READS ANYTHING FROM IT. Identity first — this is the page, this is the
 * commit, this is the deploy — then content. Three checks have passed or
 * nearly passed against the wrong surface: a collapsed <details> read with
 * innerText, a sign-in page standing in for an authed page, a 404 standing in
 * for a preview. A check that cannot confirm what it is looking at reports
 * that it could not, and never a pass.
 *
 * This file is the first half of that for a suite run: the line it prints
 * names the commit the SCRIPTS came from. It cannot speak for the build BASE
 * is serving — see the note in each suite's readiness gate — and a run whose
 * worktree line disagrees with the commit you asked for proves nothing about
 * that commit, whatever its counts say.
 */
export function guardWorktree(suite: string): void {
  const root = process.cwd()
  const dotGit = resolve(root, '.git')
  const isWorktree = existsSync(dotGit) && statSync(dotGit).isFile() && /^gitdir:/.test(readFileSync(dotGit, 'utf8'))
  let ref = '(unknown ref)'
  try { ref = execSync('git log --oneline -1 --decorate', { cwd: root, encoding: 'utf8' }).trim().slice(0, 100) } catch { /* no git */ }
  if (!isWorktree && process.env.SUITE_ALLOW_MAIN_TREE !== '1') {
    console.error(`\n${suite}: refusing to run from the main tree (${root}) — it runs whatever branch that tree happens to hold.`)
    console.error(`  Run it from a worktree:  scripts/suite-worktree.sh <ref>   then   cd ~/reckon-wt && npx tsx scripts/${suite}.ts`)
    console.error('  Or, deliberately:        SUITE_ALLOW_MAIN_TREE=1 npx tsx scripts/' + suite + '.ts\n')
    process.exit(2)
  }
  console.log(`${suite}: ${isWorktree ? 'worktree' : 'main tree (allowed)'} at ${ref} · BASE=${process.env.BASE ?? 'https://www.dryline.farm'}`)
}
