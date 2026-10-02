/**
 * Operating-system proxy discovery.
 *
 * DSH's own transport policy explicitly refuses to read an OS proxy
 * configuration: `@deepseek-ai/dsh-http-proxy` resolves `http(s)_proxy` /
 * `no_proxy` / `all_proxy` and nothing else. That is exactly the gap this
 * module fills for the "follow the system proxy" mode — on Windows, the
 * per-user WinINET settings that the Settings app and every browser obey.
 *
 * The parsing half is pure so it can be tested without Windows or a registry.
 *
 * @module dsh-network-config/system-proxy
 */
import { execFile } from 'node:child_process'

/** WinINET per-user key that holds the interactive proxy configuration. */
export const INTERNET_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

/** Proxy environment names, in the precedence order the harness documents. */
const ENV_PROXY_NAMES = {
  http: ['http_proxy', 'HTTP_PROXY'],
  https: ['https_proxy', 'HTTPS_PROXY'],
  all: ['all_proxy', 'ALL_PROXY'],
  bypass: ['no_proxy', 'NO_PROXY'],
}

/**
 * Read one environment name, lowercase first, blank treated as unset.
 * @param env - environment record.
 * @param names - the two casings of one name.
 * @returns the trimmed value, or undefined.
 */
function readEnv(env, names) {
  for (const name of names) {
    const value = env?.[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Parse the output of `reg query <key>` into a name → value record.
 *
 * `reg.exe` prints one `    Name    TYPE    Data` line per value; a value with
 * no data prints the `(value not set)` sentinel, which is dropped.
 *
 * @param output - raw stdout of `reg query`.
 * @returns the key's values, keys as written by the registry.
 */
export function parseRegistryQuery(output) {
  const values = {}
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = /^\s{2,}(\S.*?)\s{4,}(REG_[A-Z_]+)\s{4,}(.*)$/.exec(line)
    if (match === null) continue
    const [, name, type, raw] = match
    const data = raw.trim()
    if (data === '(value not set)' || data === '') continue
    values[name.trim()] = type === 'REG_DWORD' ? Number.parseInt(data, 16) : data
  }
  return values
}

/**
 * Turn a WinINET `ProxyServer` value into per-scheme proxy URLs.
 *
 * The value is either one `host:port` used for every protocol or a
 * `scheme=host:port` list. A missing scheme has no proxy; `socks=` is dropped
 * because the harness's transport refuses SOCKS and would route that scheme
 * direct anyway.
 *
 * @param server - the raw `ProxyServer` value.
 * @returns `{ http, https }` proxy URLs, each possibly undefined.
 */
export function parseProxyServer(server) {
  const value = typeof server === 'string' ? server.trim() : ''
  if (value === '') return {}
  if (!value.includes('=')) {
    const url = hostPortToUrl(value)
    return url === undefined ? {} : { http: url, https: url }
  }
  const entries = new Map()
  for (const part of value.split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const scheme = part.slice(0, at).trim().toLowerCase()
    const host = part.slice(at + 1).trim()
    if (host !== '') entries.set(scheme, host)
  }
  return {
    http: hostPortToUrl(entries.get('http')),
    https: hostPortToUrl(entries.get('https')),
  }
}

/**
 * Turn one `host:port` (or `scheme://host:port`) into a normalized proxy URL.
 * @param hostPort - the registry's host and optional port.
 * @returns the `http://…` URL, or undefined when the value is unusable.
 */
function hostPortToUrl(hostPort) {
  if (typeof hostPort !== 'string') return undefined
  const value = hostPort.trim()
  if (value === '') return undefined
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).href
    } catch {
      return undefined
    }
  }
  try {
    return new URL(`http://${value}`).href
  } catch {
    return undefined
  }
}

/**
 * Translate a WinINET `ProxyOverride` value into a bypass list the harness's
 * matcher understands.
 *
 * Everything Windows writes is kept: `<local>` and the wildcard/CIDR forms
 * (`192.168.*`, `10.0.0.0/8`) are precisely the entries that carry the "keep
 * local traffic direct" intent, and `./bypass.js` implements them. Nothing is
 * dropped here — a dropped entry is a silently misrouted request, which is
 * how every private address ended up going through the proxy.
 *
 * @param override - the raw `ProxyOverride` value.
 * @returns the normalized comma-separated list plus its entries.
 */
export function parseProxyOverride(override) {
  if (typeof override !== 'string' || override.trim() === '') return { list: '', entries: [] }
  const entries = []
  for (const raw of override.split(';')) {
    const entry = raw.trim()
    if (entry === '' || entries.includes(entry)) continue
    entries.push(entry)
  }
  return { list: entries.join(','), entries }
}

/**
 * Resolve the system proxy on Windows from one `reg query` output.
 *
 * @param output - raw stdout of `reg query <INTERNET_SETTINGS_KEY>`.
 * @returns the discovery result.
 */
export function interpretRegistry(output) {
  const values = parseRegistryQuery(output)
  const enabled = (values.ProxyEnable ?? 0) !== 0
  const pac = typeof values.AutoConfigURL === 'string' ? values.AutoConfigURL.trim() : ''
  const server = typeof values.ProxyServer === 'string' ? values.ProxyServer.trim() : ''
  const { list: bypass } = parseProxyOverride(values.ProxyOverride)
  if (!enabled) return { source: 'registry', enabled: false, server, pac, bypass }
  if (server === '') return { source: 'registry', enabled: true, server, pac, bypass }
  const { http, https } = parseProxyServer(server)
  return { source: 'registry', enabled: true, server, pac, bypass, http, https }
}

/**
 * Promisified `execFile` with a bound timeout and no shell.
 * @param file - executable to run.
 * @param args - argv.
 * @returns stdout.
 */
function execFileText(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 5000, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error !== null && error !== undefined) reject(error)
      else resolve(String(stdout))
    })
  })
}

/**
 * Discover the system proxy.
 *
 * On Windows this asks the registry (the authoritative interactive
 * configuration). Everywhere else, and whenever the registry cannot be read,
 * it falls back to the proxy environment variables the process inherited —
 * which is what a user who exported `HTTPS_PROXY` for their tooling expects.
 *
 * @param options - platform, environment, and an injectable runner for tests.
 * @returns the discovery result; never throws.
 */
export async function readSystemProxy(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const run = options.run ?? execFileText
  if (platform === 'win32') {
    try {
      const output = await run('reg.exe', ['query', INTERNET_SETTINGS_KEY])
      return interpretRegistry(output)
    } catch (error) {
      return { ...fromEnvironment(env), source: 'env', registryError: String(error?.message ?? error) }
    }
  }
  return fromEnvironment(env)
}

/**
 * Build a discovery result out of the proxy environment variables.
 * @param env - environment record.
 * @returns the discovery result.
 */
export function fromEnvironment(env) {
  const http = readEnv(env, ENV_PROXY_NAMES.http) ?? readEnv(env, ENV_PROXY_NAMES.all)
  const https = readEnv(env, ENV_PROXY_NAMES.https) ?? readEnv(env, ENV_PROXY_NAMES.all) ?? http
  const bypass = readEnv(env, ENV_PROXY_NAMES.bypass) ?? ''
  return {
    source: 'env',
    enabled: http !== undefined || https !== undefined,
    server: http ?? https ?? '',
    pac: '',
    bypass,
    ...(http === undefined ? {} : { http }),
    ...(https === undefined ? {} : { https }),
  }
}
