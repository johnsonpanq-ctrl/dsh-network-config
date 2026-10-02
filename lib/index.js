/**
 * dsh-network-config 鈥?host half.
 *
 * Owns one process-wide decision: how DeepSeek Harness reaches the network.
 * The user picks it in Settings (follow the Windows system proxy, connect
 * directly, or name a proxy), this half turns that choice into the transport
 * policy `@deepseek-ai/dsh-http-proxy` installs, and a small fenced HTTP
 * surface lets the settings page read and change it.
 *
 * The policy is installed through that package rather than by building a
 * dispatcher here: every outbound call site in the harness 鈥?the LLM stack,
 * web search, web fetch, HTTP MCP 鈥?plus `proxyRouteFor()` must agree on one
 * answer, and the package is the only owner of that answer.
 *
 * @module dsh-network-config
 */
import { NetworkStore, defaultStorePath, validateSubmission } from './store.js'
import { readSystemProxy } from './system-proxy.js'
import { PROXY_ENV_NAMES, clearProxyEnvironment, resolvePolicy, toPolicyEnvironment } from './policy.js'
import { compileBypass } from './bypass.js'
import { installRouting } from './routing.js'
import { REJECTION_TEXT, TRANSPORT_MISSING } from './text.js'

/** Route prefix owned by this plugin. */
const ROUTE = '/dsh-network-config'

/** Loader identity reported for this plugin's fiber. */
export const name = 'dsh-network-config'

/** URL the settings page's "test connection" button reaches by default. */
const PROBE_URL = 'https://www.deepseek.com/'

/** Largest settings submission accepted from the page. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Hide credentials inside a proxy URL before it crosses to the browser.
 * @param value - a proxy URL or any string.
 * @returns the string with its userinfo replaced.
 */
function redact(value) {
  if (typeof value !== 'string') return value
  return value.replace(/\/\/[^/@\s]*@/, '//***@')
}

/** Write one JSON response. */
function writeJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

/**
 * Read and parse a bounded JSON request body.
 * @param request - the node request.
 * @returns the parsed body, or an empty object for an empty body.
 */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Whether one request may reach this plugin's routes.
 *
 * A DNS-rebinding / cross-site fence, not authentication: the Host authority
 * must be loopback, and a browser that marks the request cross-site is
 * refused. An `Origin` of `null` (a `file:` page in the desktop shell) is
 * accepted because the Host fence has already bound the authority.
 *
 * @param request - the node request.
 * @returns true when the request is trusted.
 */
function isTrustedRequest(request) {
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  const loopback = hostname === 'localhost'
    || hostname === '::1'
    || hostname === '0.0.0.0'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  if (!loopback) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === 'null') return true
  try {
    return new URL(origin).hostname.replace(/^\[|\]$/g, '') === hostname
  } catch {
    return false
  }
}

/**
 * Mount the network-settings plugin.
 *
 * @param ctx - the host plugin context.
 * @param config - optional `{ storePath }` override for the settings document.
 */
export function apply(ctx, config) {
  const configuredPath = typeof config?.storePath === 'string' && config.storePath.trim() !== ''
    ? config.storePath
    : undefined
  const store = new NetworkStore(configuredPath ?? defaultStorePath())

  /** Disposer returned by the transport package for the installed policy. */
  let transportDisposer
  /** The proxy environment as it was before this plugin touched it. */
  let envSnapshot
  /** What is installed right now, for the settings page. */
  let applied
  /** Diagnostics from the last install, in the order they were produced. */
  let diagnostics = []
  /** Last install failure, if any. */
  let lastError
  /** Serializes installs so two saves cannot interleave dispatcher swaps. */
  let installChain = Promise.resolve()
  let disposed = false

  const captureEnvironment = () => {
    if (envSnapshot !== undefined) return
    envSnapshot = new Map(PROXY_ENV_NAMES.map((name) => [name, process.env[name]]))
  }

  const restoreEnvironment = () => {
    if (envSnapshot === undefined) return
    for (const [name, value] of envSnapshot) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
    envSnapshot = undefined
  }

  /**
   * Install the policy one document resolves to, replacing whatever was
   * installed before.
   * @param document - the validated settings document.
   * @returns the resolved policy and the OS discovery it used.
   */
  const install = async (document) => {
    const system = document.mode === 'system' ? await readSystemProxy() : undefined
    const resolved = resolvePolicy(document, system)
    diagnostics = [...resolved.diagnostics]
    // The previous policy is torn down before the snapshot is restored, so
    // the environment the transport package captured for a direct policy is
    // never mistaken for this plugin's own edits.
    try {
      await transportDisposer?.()
    } catch {
      // Disposal is best effort: the next install replaces the dispatcher
      // anyway, and a failure here must not block the new policy.
    }
    transportDisposer = undefined
    restoreEnvironment()
    let httpProxy
    try {
      httpProxy = await import('@deepseek-ai/dsh-http-proxy')
    } catch (error) {
      lastError = `${TRANSPORT_MISSING} (${String(error?.message ?? error)})`
      applied = undefined
      return { resolved, system }
    }
    captureEnvironment()
    clearProxyEnvironment()
    const packageDisposer = await httpProxy.installProxyFromEnvironment(
      toPolicyEnvironment(resolved),
      (message) => { diagnostics.push(message) },
    )
    // The package owns the policy — which is what `proxyRouteFor()` and every
    // spawned child read — but its bypass matcher cannot express what Windows
    // writes into `ProxyOverride` (`192.168.*`) and cannot keep private
    // addresses direct. The dispatcher that actually carries the traffic is
    // therefore this plugin's, layered on top of the package's.
    let routingDisposer
    if (!resolved.direct) {
      try {
        routingDisposer = await installRouting({
          httpProxy: resolved.httpProxy,
          httpsProxy: resolved.httpsProxy,
          bypass: compileBypass(resolved.noProxy),
        })
      } catch (error) {
        diagnostics.push(`无法安装完整的绕过匹配（${String(error?.message ?? error)}），系统绕过列表里的通配写法与内网地址可能仍会走代理。`)
      }
    }
    transportDisposer = async () => {
      await routingDisposer?.()
      await packageDisposer?.()
    }
    // A direct policy makes the package restore the launcher's environment,
    // which may still name a proxy for spawned children; the user asked for
    // no proxy at all, so the cleanup is repeated after the install.
    if (resolved.direct) clearProxyEnvironment()
    lastError = undefined
    applied = {
      mode: resolved.mode,
      direct: resolved.direct,
      summary: redact(resolved.summary),
      httpProxy: redact(resolved.httpProxy),
      httpsProxy: redact(resolved.httpsProxy),
      noProxy: resolved.noProxy,
      bypassCount: compileBypass(resolved.noProxy).size,
      privateDirect: true,
      fullBypass: routingDisposer !== undefined,
      at: Date.now(),
    }
    return { resolved, system }
  }

  /**
   * Queue one install behind any install still running.
   * @param document - the validated settings document.
   * @returns the install result.
   */
  const reinstall = (document) => {
    const run = installChain.then(() => (disposed ? undefined : install(document)))
    // Keep the chain alive after a failure; the failure is reported through
    // `lastError`, not by rejecting every later save.
    installChain = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * The operating system's current proxy configuration, for display.
   * @returns the discovery result, or undefined when the mode does not read it.
   */
  const systemView = async (document) => {
    if (document.mode !== 'system') return undefined
    const system = await readSystemProxy()
    return {
      source: system.source,
      enabled: system.enabled,
      server: redact(system.server),
      pac: system.pac,
      bypass: system.bypass,
      registryError: system.registryError,
    }
  }

  /**
   * The whole state the settings page renders.
   * @returns the state payload.
   */
  const statePayload = async () => {
    const document = await store.load()
    return {
      config: document,
      storePath: store.path,
      applied: applied ?? null,
      diagnostics,
      lastError: lastError ?? null,
      system: await systemView(document),
      probeUrl: PROBE_URL,
    }
  }

  /**
   * Reach one URL through whatever the process currently routes.
   * @param url - the absolute URL to request.
   * @returns the probe outcome.
   */
  const runProbe = async (url) => {
    const started = Date.now()
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      })
      return { ok: true, status: response.status, ms: Date.now() - started, url }
    } catch (error) {
      return { ok: false, ms: Date.now() - started, url, error: String(error?.message ?? error) }
    }
  }

  ctx.effect(() => () => {
    disposed = true
    void Promise.resolve()
      .then(() => transportDisposer?.())
      .catch(() => { /* disposal is best effort */ })
      .finally(() => {
        transportDisposer = undefined
        restoreEnvironment()
      })
  }, 'dsh-network-config: transport policy')

  ctx.inject(['webServer'], (hostCtx) => {
    const handle = async (request, response, route) => {
      if (!isTrustedRequest(request)) {
        writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      try {
        if (route === 'state' && request.method === 'GET') {
          writeJson(response, 200, { ok: true, state: await statePayload() })
          return
        }
        if (route === 'state' && request.method === 'POST') {
          const body = await readJsonBody(request)
          const verdict = validateSubmission(body)
          if (!verdict.ok) {
            const reason = REJECTION_TEXT[verdict.reason] ?? verdict.reason
            writeJson(response, 400, { ok: false, error: { code: 'invalid', message: reason } })
            return
          }
          await store.save(verdict.config)
          await reinstall(store.config)
          writeJson(response, 200, { ok: true, state: await statePayload() })
          return
        }
        if (route === 'probe' && request.method === 'POST') {
          const body = await readJsonBody(request)
          const url = typeof body.url === 'string' && body.url.trim() !== '' ? body.url.trim() : PROBE_URL
          let target
          try {
            target = new URL(url)
          } catch {
            writeJson(response, 400, { ok: false, error: { code: 'invalid', message: 'probe target is not a URL' } })
            return
          }
          if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            writeJson(response, 400, { ok: false, error: { code: 'invalid', message: 'probe target must be http(s)' } })
            return
          }
          writeJson(response, 200, { ok: true, result: await runProbe(target.href) })
          return
        }
        writeJson(response, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
      } catch (error) {
        writeJson(response, 500, {
          ok: false,
          error: { code: 'internal', message: String(error?.message ?? error) },
        })
      }
    }

    const routes = []
    for (const name of ['state', 'probe']) {
      routes.push(hostCtx.webServer.register({
        kind: 'exact',
        path: `${ROUTE}/${name}`,
        handler: async (request, response) => handle(request, response, name),
      }))
    }
    hostCtx.effect(() => () => {
      for (const dispose of routes) dispose()
    }, 'dsh-network-config: settings routes')
  })

  // Apply the stored mode at mount, so a restart keeps the user's choice.
  void (async () => {
    try {
      await store.load()
      await reinstall(store.config)
    } catch (error) {
      lastError = String(error?.message ?? error)
    }
  })()
}
