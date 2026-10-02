/**
 * Turn one of the three user-facing modes into the concrete policy the
 * harness's transport layer installs.
 *
 * The plugin never builds its own undici dispatcher: it hands a resolved
 * policy to `@deepseek-ai/dsh-http-proxy`, so the dispatcher, the published
 * environment, and the loopback bypass all stay owned by the package that
 * every other outbound call site already consults.
 *
 * Pure and transport-free, so the mode table is unit-testable.
 *
 * @module dsh-network-config/policy
 */
import { isSupportedProxyUrl } from './store.js'

/** Proxy environment names this plugin owns while a policy is installed. */
export const PROXY_ENV_NAMES = [
  'http_proxy', 'HTTP_PROXY',
  'https_proxy', 'HTTPS_PROXY',
  'no_proxy', 'NO_PROXY',
  'all_proxy', 'ALL_PROXY',
]

/**
 * The settings document plus what the operating system currently reports,
 * resolved into one install decision.
 *
 * @typedef {object} ResolvedPolicy
 * @property {'system' | 'direct' | 'custom'} mode - the mode that produced this decision.
 * @property {string | undefined} httpProxy - proxy for `http:` requests.
 * @property {string | undefined} httpsProxy - proxy for `https:` requests.
 * @property {string} noProxy - bypass list handed to the transport.
 * @property {boolean} direct - true when nothing is proxied.
 * @property {string[]} diagnostics - human-readable notes about what was skipped.
 * @property {string} summary - one-line description of the effective route.
 */

/**
 * Resolve the effective policy.
 *
 * `system` consumes the OS discovery result: an enabled proxy with a usable
 * server becomes the policy, a PAC script is reported and skipped (the
 * harness's transport refuses PAC URLs), and a disabled proxy means direct.
 *
 * @param config - the validated settings document.
 * @param system - the {@link readSystemProxy} result, when mode is `system`.
 * @returns the resolved policy.
 */
export function resolvePolicy(config, system) {
  const diagnostics = []
  if (config.mode === 'direct') {
    return { mode: 'direct', httpProxy: undefined, httpsProxy: undefined, noProxy: '', direct: true, diagnostics, summary: 'direct' }
  }
  if (config.mode === 'custom') {
    const proxy = config.custom.proxy.trim()
    if (!isSupportedProxyUrl(proxy)) {
      diagnostics.push('自定义代理地址不可用（只支持 http:// 或 https://），已按直连处理。')
      return { mode: 'custom', httpProxy: undefined, httpsProxy: undefined, noProxy: config.custom.bypass, direct: true, diagnostics, summary: 'direct' }
    }
    return {
      mode: 'custom',
      httpProxy: proxy,
      httpsProxy: proxy,
      noProxy: config.custom.bypass,
      direct: false,
      diagnostics,
      summary: proxy,
    }
  }
  // mode === 'system'
  if (system === undefined || system === null) {
    return { mode: 'system', httpProxy: undefined, httpsProxy: undefined, noProxy: '', direct: true, diagnostics, summary: 'direct' }
  }
  if (system.registryError !== undefined) {
    diagnostics.push(`读取 Windows 系统代理失败（${system.registryError}），已改用环境变量。`)
  }
  if (!system.enabled) {
    return { mode: 'system', httpProxy: undefined, httpsProxy: undefined, noProxy: '', direct: true, diagnostics, summary: 'direct' }
  }
  const httpProxy = system.http
  const httpsProxy = system.https ?? system.http
  if (httpProxy === undefined && httpsProxy === undefined) {
    if (system.pac !== '') {
      diagnostics.push('系统配置了 PAC 自动配置脚本，Harness 的传输层不支持 PAC，已按直连处理。')
    } else if (system.server !== '') {
      diagnostics.push(`系统代理 "${system.server}" 无法解析为 http(s) URL，已按直连处理。`)
    }
    return { mode: 'system', httpProxy: undefined, httpsProxy: undefined, noProxy: system.bypass, direct: true, diagnostics, summary: 'direct' }
  }
  for (const [scheme, url] of [['http', httpProxy], ['https', httpsProxy]]) {
    if (url !== undefined && !isSupportedProxyUrl(url)) {
      diagnostics.push(`系统 ${scheme} 代理 "${url}" 不是 http(s) 地址，该协议将直连。`)
    }
  }
  const usableHttp = httpProxy !== undefined && isSupportedProxyUrl(httpProxy) ? httpProxy : undefined
  const usableHttps = httpsProxy !== undefined && isSupportedProxyUrl(httpsProxy) ? httpsProxy : undefined
  return {
    mode: 'system',
    httpProxy: usableHttp,
    httpsProxy: usableHttps,
    noProxy: system.bypass,
    direct: usableHttp === undefined && usableHttps === undefined,
    diagnostics,
    summary: usableHttps ?? usableHttp ?? 'direct',
  }
}

/**
 * Build the environment view {@link installProxyFromEnvironment} resolves.
 *
 * The package reads a `Map` whose entries expose `value`, lower case first,
 * with the upper case as fallback — the same shape the launcher builds from
 * the process environment. Supplying both casings matches what the package
 * itself publishes, so a child that reads either casing sees one answer.
 *
 * @param resolved - the policy from {@link resolvePolicy}.
 * @returns the environment view to install.
 */
export function toPolicyEnvironment(resolved) {
  const env = new Map()
  if (resolved.httpProxy !== undefined) {
    env.set('http_proxy', { value: resolved.httpProxy })
    env.set('HTTP_PROXY', { value: resolved.httpProxy })
  }
  if (resolved.httpsProxy !== undefined) {
    env.set('https_proxy', { value: resolved.httpsProxy })
    env.set('HTTPS_PROXY', { value: resolved.httpsProxy })
  }
  if (resolved.noProxy !== '') {
    env.set('no_proxy', { value: resolved.noProxy })
    env.set('NO_PROXY', { value: resolved.noProxy })
  }
  return env
}

/**
 * Remove every proxy name this plugin owns from a process environment.
 *
 * `installProxyFromEnvironment` publishes `http_proxy`/`https_proxy`/
 * `no_proxy` for a proxied policy and restores the launcher's snapshot for a
 * direct one; `all_proxy` it never touches, so a stale `ALL_PROXY` would keep
 * routing spawned children after the user asked for a direct connection.
 *
 * @param env - the environment to clean (defaults to `process.env`).
 */
export function clearProxyEnvironment(env = process.env) {
  for (const name of PROXY_ENV_NAMES) Reflect.deleteProperty(env, name)
}
