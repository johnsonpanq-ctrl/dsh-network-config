#!/usr/bin/env node
// Scan tracked text files for a corrupted write.
//
// The failure this guards against is real and specific: a file written as UTF-8
// was read back as a single-byte codepage and re-encoded, so every multi-byte
// character became two or three unrelated ones. The result parses as Chinese,
// which is why it survives review — but it is not the text anyone wrote.
//
// Two signals, both unambiguous:
//   1. U+FFFD, the replacement character (bytes that decoded as invalid UTF-8).
//   2. A UTF-8 BOM, which the repository's own tooling never writes.
//
// The mixed-script heuristic is deliberately NOT used: a legitimate Chinese
// document contains 错 (U+9519), so that character proves nothing on its own.
//
// Usage: node tools/check-encoding.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && /\.(js|mjs|json|md|yml|yaml|ps1|txt)$/.test(line))

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
let problems = 0

for (const file of files) {
  const bytes = readFileSync(file)
  if (bytes.subarray(0, 3).equals(BOM)) {
    console.log(`BOM         ${file}`)
    problems += 1
  }
  const text = bytes.toString('utf8')
  const index = text.indexOf('\uFFFD')
  if (index !== -1) {
    const line = text.slice(0, index).split('\n').length
    console.log(`REPLACEMENT ${file}:${line}`)
    problems += 1
  }
}

console.log(problems === 0 ? `clean (${files.length} files)` : `${problems} problem(s)`)
process.exit(problems === 0 ? 0 : 1)
