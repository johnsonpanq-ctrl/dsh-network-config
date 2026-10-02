#!/usr/bin/env node
// Verify every relative markdown link in the tracked .md files points at a
// file that exists in the repository. Absolute URLs are listed for a manual
// glance but not fetched (CI must not depend on the network).
//
// Usage: node tools/check-links.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const LINK = /\[[^\]]*\]\(([^)]+)\)/g
let problems = 0
let relative = 0

for (const file of files) {
  // Read the working tree, not the commit: this must catch a broken link in a
  // file that has not been staged yet.
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(LINK)) {
    const raw = match[1].trim()
    if (raw === '' || raw.startsWith('#')) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue
    const target = raw.split('#')[0]
    if (target === '') continue
    relative += 1
    const resolved = join(dirname(file), decodeURIComponent(target))
    if (!existsSync(resolved)) {
      console.log(`BROKEN ${file} -> ${raw}`)
      problems += 1
    }
  }
}

console.log(
  problems === 0
    ? `clean (${relative} relative link(s) across ${files.length} file(s))`
    : `${problems} broken link(s)`,
)
process.exit(problems === 0 ? 0 : 1)
