#!/usr/bin/env node
// Refuse to commit anything that looks like a real address from the author's own
// network.
//
// This repository is published, and its test cases and benchmark tables are the
// natural place for a real LAN or overlay address to slip in unnoticed: a
// "measured on a real machine" table is more convincing with the address that was
// actually measured, and a test written against a live endpoint keeps that
// endpoint. Neither is a secret worth publishing.
//
// Everything in the documentation ranges is allowed, because those are the
// addresses a published example is supposed to use:
//   RFC 5737  documentation  192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
// Everything in the ranges below is allowed, because an address in a reserved
// range points at no real device and therefore says nothing about the machine
// this was developed on:
//   RFC 1918  private        10/8, 172.16/12, 192.168/16
//   RFC 6598  CGNAT          100.64/10
//   RFC 3927  link-local     169.254/16
//   loopback                 127/8, ::1
//   RFC 5737  documentation  192.0.2/24, 198.51.100/24, 203.0.113/24
//   plus a handful of public addresses used as deliberate negatives.
//
// This does NOT mean an address from a private range is always fine to publish:
// 172.20.0.10 still names one specific machine on one specific LAN. The point
// of this check is narrower — catch a routable public address, and catch the
// private address of the author's own network appearing with its real port. The
// examples use the boring members of the ranges (100.64.0.10, 172.20.0.10).
//
// Usage: node tools/check-private-addresses.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Ranges whose contents are safe to publish. */
const ALLOWED = [
  /^192\.0\.2\.\d{1,3}$/, // RFC 5737 documentation
  /^198\.51\.100\.\d{1,3}$/,
  /^203\.0\.113\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // RFC 1918
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/, // RFC 6598 CGNAT
  /^169\.254\.\d{1,3}\.\d{1,3}$/, // RFC 3927
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // loopback
  /^0\.0\.0\.0$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // RFC 1918
]

/** Public addresses that appear as deliberate negatives or arithmetic constants. */
const KNOWN_PUBLIC = new Set([
  '8.8.8.8', '1.1.1.1', '9.9.9.9', '208.67.222.222',
  '100.63.255.255', '100.128.0.1', // just outside the CGNAT block
  '172.15.0.1', '172.32.0.1', '192.169.0.1', '192.169.1.1', '11.0.0.1',
  '255.255.255.255', // the IPv4 broadcast address, used as a parser upper bound
])

// The examples in the READMEs and tests use the *neutral* members of the ranges
// this plugin treats as private — 100.64.0.10 and 172.20.0.10 — rather than any
// address from the machine this was developed on. RFC 5737's documentation
// blocks (192.0.2.0/24, 198.51.100.0/24) are deliberately NOT used for those
// examples: they are public addresses, so substituting them silently changes
// what a test asserts.

const IPV4 = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && /\.(js|mjs|json|md|yml|yaml|ps1|txt)$/.test(line))

let problems = 0
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const match of line.matchAll(IPV4)) {
      const address = match[1]
      const octets = address.split('.').map(Number)
      if (octets.some((value) => value > 255)) continue
      if (KNOWN_PUBLIC.has(address)) continue
      if (ALLOWED.some((pattern) => pattern.test(address))) continue
      console.log(`${file}:${index + 1}  ${address}`)
      console.log(`    ${line.trim().slice(0, 120)}`)
      problems += 1
    }
  })
}

console.log(
  problems === 0
    ? `clean (${files.length} files)`
    : `${problems} address(es) outside the documentation ranges`,
)
process.exit(problems === 0 ? 0 : 1)
