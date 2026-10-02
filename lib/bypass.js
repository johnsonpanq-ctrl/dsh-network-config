/**
 * The bypass decision.
 *
 * `@deepseek-ai/dsh-http-proxy` matches a bypass entry as a hostname or a
 * hostname suffix and nothing else: an entry `192.168.*` — which is exactly
 * what Windows writes into `ProxyOverride` — can never equal a host and can
 * never be a suffix of one, so it is silently inert and every private address
 * the operating system asked to keep direct goes to the proxy instead.
 *
 * This module is the missing matcher. It understands the forms an operating
 * system and a user actually write (prefix wildcards, CIDR, `<local>`,
 * suffixes, ports), and it keeps addresses a forward proxy cannot reach
 * direct by construction.
 *
 * Pure and transport-free, so the whole decision table is unit-testable.
 *
 * @module dsh-network-config/bypass
 */

/** Loopback and private IPv4 blocks no forward proxy can route meaningfully. */
const PRIVATE_V4 = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // RFC 6598 carrier-grade NAT (also used by overlays such as Tailscale)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // RFC 1918
  ['192.168.0.0', 16], // RFC 1918
]

/** Loopback and private IPv6 blocks, matched by textual prefix. */
const PRIVATE_V6_PREFIXES = ['::1', '::', 'fc', 'fd', 'fe8', 'fe9', 'fea', 'feb']

/**
 * Parse one dotted-quad into a 32-bit integer.
 * @param value - the candidate address.
 * @returns the integer, or undefined when the text is not a valid IPv4 literal.
 */
export function ipv4ToInt(value) {
  const parts = String(value ?? '').split('.')
  if (parts.length !== 4) return undefined
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    result = (result * 256) + octet
  }
  return result
}

/**
 * Whether a value is a valid IPv4 literal.
 * @param value - the candidate address.
 * @returns true for a dotted quad.
 */
export function isIpv4(value) {
  return ipv4ToInt(value) !== undefined
}

/**
 * Whether a hostname is loopback, private, link-local, or carrier-grade NAT.
 *
 * These are addresses a forward proxy cannot reach: it would resolve them in
 * its own network, so sending them through one breaks every LAN service —
 * local model endpoints above all. The harness only exempts loopback, so the
 * rest of the table lives here.
 *
 * @param hostname - a URL hostname, bracketed or not.
 * @returns true when the destination must stay direct.
 */
export function isPrivateHost(hostname) {
  const host = String(hostname ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (host === '') return false
  const mapped = /^::ffff:(.+)$/.exec(host)
  if (mapped !== null) return isPrivateHost(mapped[1])
  const value = ipv4ToInt(host)
  if (value !== undefined) {
    return PRIVATE_V4.some(([base, bits]) => {
      const network = ipv4ToInt(base)
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
      return ((value & mask) >>> 0) === ((network & mask) >>> 0)
    })
  }
  if (host.includes(':')) return PRIVATE_V6_PREFIXES.some((prefix) => host.startsWith(prefix))
  return host === 'localhost' || host.endsWith('.localhost')
}

/**
 * Split one bypass entry into its host and optional port.
 *
 * A bare IPv6 literal carries several colons and no port, so only a
 * single-colon entry splits.
 *
 * @param entry - one already-trimmed, lowercased entry.
 * @returns the entry's host and, when present, its port.
 */
function splitHostPort(entry) {
  if (entry.startsWith('[')) {
    const close = entry.indexOf(']')
    if (close !== -1) {
      const rest = entry.slice(close + 1)
      const host = entry.slice(1, close)
      return rest.startsWith(':') ? { host, port: rest.slice(1) } : { host }
    }
  }
  const colon = entry.indexOf(':')
  if (colon !== -1 && entry.indexOf(':', colon + 1) === -1) {
    return { host: entry.slice(0, colon), port: entry.slice(colon + 1) }
  }
  return { host: entry }
}

/**
 * Compile an entry into its matcher.
 * @param entry - one trimmed, lowercased bypass entry.
 * @returns the compiled entry, or undefined when it is unusable.
 */
function compileEntry(entry) {
  if (entry === '') return undefined
  if (entry === '*') return { kind: 'all' }
  const { host, port } = splitHostPort(entry)
  if (host === '') return undefined
  if (host === '<local>') return { kind: 'local', port }
  const cidr = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(host)
  if (cidr !== null) {
    const network = ipv4ToInt(cidr[1])
    const bits = Number(cidr[2])
    if (network !== undefined && bits <= 32) return { kind: 'v4net', network, bits, port }
  }
  const wildcard = /^(\d{1,3}(?:\.\d{1,3})*)\.\*$/.exec(host)
  if (wildcard !== null) {
    const octets = wildcard[1].split('.').map(Number)
    if (octets.every((octet) => octet <= 255)) return { kind: 'v4wild', octets, port }
  }
  const bare = host.replace(/^\*?\./, '').replace(/\.$/, '')
  if (bare === '') return undefined
  const value = ipv4ToInt(bare)
  if (value !== undefined) return { kind: 'v4exact', value, port }
  return { kind: 'host', host: bare, port }
}

/** Whether one compiled entry exempts a host and port. */
function entryMatches(entry, host, port) {
  if (entry.port !== undefined && entry.port !== port) return false
  if (entry.kind === 'all') return true
  if (entry.kind === 'local') return !host.includes('.') && ipv4ToInt(host) === undefined
  if (entry.kind === 'host') return host === entry.host || host.endsWith(`.${entry.host}`)
  const value = ipv4ToInt(host)
  if (value === undefined) return false
  if (entry.kind === 'v4exact') return value === entry.value
  if (entry.kind === 'v4wild') {
    const octets = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]
    return entry.octets.every((octet, index) => octets[index] === octet)
  }
  const mask = entry.bits === 0 ? 0 : (0xffffffff << (32 - entry.bits)) >>> 0
  return ((value & mask) >>> 0) === ((entry.network & mask) >>> 0)
}

/**
 * Compile a comma/space separated bypass list.
 *
 * @param text - the list as the operating system or the user wrote it.
 * @returns a matcher over `(hostname, port)`.
 */
export function compileBypass(text) {
  const compiled = []
  let all = false
  for (const raw of String(text ?? '').split(/[,\s]+/)) {
    const entry = compileEntry(raw.trim().toLowerCase())
    if (entry === undefined) continue
    if (entry.kind === 'all') all = true
    else compiled.push(entry)
  }
  return {
    /** Whether the list bypasses everything. */
    all,
    /** The raw entry count, for diagnostics. */
    size: compiled.length + (all ? 1 : 0),
    /**
     * Whether one destination bypasses the proxy.
     * @param hostname - a URL hostname.
     * @param port - the destination port as text.
     * @returns true when the destination must stay direct.
     */
    matches(hostname, port) {
      if (all) return true
      const host = String(hostname ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
      return compiled.some((entry) => entryMatches(entry, host, String(port ?? '')))
    },
  }
}

/**
 * Decide which proxy one URL goes through.
 *
 * This is the single answer the plugin's dispatcher consults, so the route it
 * installs and the route it reports can never disagree. It is a superset of
 * `@deepseek-ai/dsh-http-proxy`'s own matcher: same policy, plus the entry
 * forms that matcher cannot express and the private addresses that must never
 * be tunnelled.
 *
 * @param policy - `{ httpProxy, httpsProxy }`.
 * @param url - the request URL.
 * @param bypass - the compiled bypass list.
 * @returns the proxy URL to tunnel through, or undefined for a direct connection.
 */
export function proxyForRequest(policy, url, bypass) {
  const proxy = url.protocol === 'https:'
    ? policy.httpsProxy
    : url.protocol === 'http:'
      ? policy.httpProxy
      : undefined
  if (proxy === undefined) return undefined
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isPrivateHost(host)) return undefined
  const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80'
  return bypass.matches(host, port) ? undefined : proxy
}
