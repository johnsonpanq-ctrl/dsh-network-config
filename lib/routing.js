/**
 * The transport the plugin installs.
 *
 * `@deepseek-ai/dsh-http-proxy` owns the process-wide policy, but its bypass
 * matcher cannot express the entries an operating system writes — see
 * `./bypass.js`. So the plugin layers one per-origin dispatcher of its own on
 * top of the package's: the package still resolves and publishes the policy
 * (which is what `proxyRouteFor()` and every child process read), while the
 * dispatcher that actually carries the traffic consults the full matcher.
 *
 * The factory mirrors the package's own per-origin Agent, so routing is
 * decided by origin exactly as the package does it — one `ProxyAgent` per
 * proxied origin, one `Pool` per direct one.
 *
 * @module dsh-network-config/routing
 */
import { proxyForRequest } from './bypass.js'

/**
 * Install the routing dispatcher.
 *
 * `undici` is imported dynamically for the same reason the harness package
 * imports it dynamically: this module must stay loadable where no Node
 * transport exists, and a missing transport has to surface as a reportable
 * failure rather than a load-time crash.
 *
 * @param options - the resolved policy, its compiled bypass list, and a report sink.
 * @returns a disposer restoring the previous dispatcher and closing the agent.
 */
export async function installRouting(options) {
  const { Agent, Pool, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici')
  const policy = { httpProxy: options.httpProxy, httpsProxy: options.httpsProxy }
  const bypass = options.bypass
  const previous = getGlobalDispatcher()
  const agent = new Agent({
    factory(origin, factoryOptions) {
      const proxy = proxyForRequest(policy, new URL(origin.toString()), bypass)
      if (proxy !== undefined) return new ProxyAgent({ ...factoryOptions, uri: proxy })
      return new Pool(origin, factoryOptions)
    },
  })
  setGlobalDispatcher(agent)
  return async () => {
    setGlobalDispatcher(previous)
    await agent.close()
  }
}
