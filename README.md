# dsh-network-config

**Proxy settings for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a Network page in Settings where you pick how the whole app reaches the internet, and it takes effect immediately.**

```
Settings → Network
  ( ) Follow system     read the Windows system proxy and follow its on/off switch
  ( ) Direct            no proxy at all
  (•) Custom            point at your own http(s) proxy, with a bypass list
```

No restart, no environment variables to export, no editing YAML. Models, web search,
web fetch, and HTTP MCP all move to the new route the moment you hit Save.

---

## Why it exists

DeepSeek Harness reads its outbound proxy policy **once, at launch**, from the
`http_proxy` / `https_proxy` / `no_proxy` / `all_proxy` environment variables. That
leaves two everyday problems:

1. **You have to set environment variables before starting the app**, and restart it
   every time your proxy changes.
2. **"Follow the system proxy" isn't supported at all** — the harness deliberately
   refuses to read the OS proxy configuration, so a user who flipped the switch in
   their proxy client still has to export variables ([documented limitation](https://github.com/deepseek-ai/deepseek-harness)).

This plugin adds the missing surface, and while doing so it also fixes a bug that
silently breaks LAN access — see below.

## Built-in bypasses (the part that matters)

Whenever a proxy is in use, these destinations **always stay direct**, with no
configuration from you:

| Category | Ranges |
|---|---|
| Loopback | `localhost`, `127.0.0.0/8`, `::1` |
| Private (RFC 1918) | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Link-local | `169.254.0.0/16`, `fe80::/10` |
| Carrier-grade NAT | `100.64.0.0/10` (also where Tailscale lives) |

A forward proxy resolves addresses **in its own network**, so handing it an
intranet destination only ever produces a timeout or a 502. That is exactly what
happens with the harness alone: it exempts loopback and nothing else.

And every entry the operating system wrote into its bypass list is honoured —
including the forms the harness's own matcher cannot express:

| Entry Windows writes | Meaning | Harness alone | This plugin |
|---|---|---|---|
| `192.168.*` | prefix wildcard | ❌ never matches | ✅ |
| `10.0.0.0/8` | CIDR | ❌ never matches | ✅ |
| `<local>` | any host without a dot | ❌ never matches | ✅ |
| `*.corp.example` | suffix | ✅ | ✅ |
| `api.test:8443` | host with port | ✅ | ✅ |

Measured on a real machine with a system proxy configured (a local model endpoint
on a private address, reachable directly in ~20 ms):

| Target | Harness alone | With this plugin |
|---|---|---|
| `http://100.68.18.63:7863/v1/models` | **HTTP 502 · 5175 ms** | **HTTP 401 · 22 ms** |
| `http://192.168.99.97:8080/v1/models` | 401 · 8 ms | 401 · 4 ms |
| `https://www.deepseek.com/` | 200 | 200 · 253 ms *(still proxied — correct)* |

## Install

**Requirements:** DeepSeek Harness desktop (Windows for the *Follow system* mode;
elsewhere the plugin still works, but that mode falls back to reading the
environment) and PowerShell.

1. Download `dsh-network-config-1.0.0.zip` from
   [Releases](../../releases) — or clone this repo.
2. Extract anywhere, then in that folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

3. **Fully quit and reopen DeepSeek Harness.** The module graph is built at
   startup; a running app cannot pick up a newly installed plugin.

4. Verify:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify.ps1
```

```
1. Is the plugin mounted at http://127.0.0.1:19387 ?   YES
2. mode: system   route: http://127.0.0.1:7890/
   bypass entries: 21   private direct: True   full matcher: True
3. Reach a public address (must use the proxy) : https://www.deepseek.com/
   reachable - HTTP 200 in 163 ms
```

Full walkthrough, manual install, migration to another machine, and a
troubleshooting list: **[INSTALL.md](INSTALL.md)**.

### Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

Then restart the app. The plugin occupies one directory plus one line in the
profile's `dsh.profile.bundles`; its only data file is
`%USERPROFILE%\.dsh\network-config.json`.

## How it works

The plugin never builds its own proxy policy from scratch. It hands the resolved
mode to `@deepseek-ai/dsh-http-proxy` — the harness's own package — so
`proxyRouteFor()`, the published environment variables, and every spawned child
process all keep seeing one consistent answer.

It then swaps **the dispatcher that actually carries the traffic** for its own
per-origin agent, because that package's bypass matcher only does exact-host and
suffix matching. Both halves are needed: the package keeps the process-wide
contract, the plugin's matcher implements the entries that contract cannot express.

```
Settings → Network          (client/client.js)
     │  GET  /dsh-network-config/state
     │  POST /dsh-network-config/state   { mode, custom: { proxy, bypass } }
     ▼
host half                   (lib/index.js)
     │  validate → store.save → resolvePolicy
     ├─ installProxyFromEnvironment   ← the official policy: proxyRouteFor(),
     │                                  env vars, child processes
     └─ installRouting(compileBypass) ← the dispatcher that carries traffic
     ▼
undici global dispatcher + http_proxy / https_proxy / no_proxy
```

### Source map

| File | Role |
|---|---|
| [`lib/index.js`](lib/index.js) | Host half: settings document, policy resolution, transport install, the HTTP routes |
| [`lib/bypass.js`](lib/bypass.js) | The bypass matcher: wildcards, CIDR, `<local>`, suffixes, ports, private-address detection |
| [`lib/routing.js`](lib/routing.js) | Per-origin undici dispatcher that asks `lib/bypass.js` where each request goes |
| [`lib/system-proxy.js`](lib/system-proxy.js) | Windows system proxy discovery (`reg query` → proxy URLs + bypass list) |
| [`lib/policy.js`](lib/policy.js) | The three modes → a transport policy |
| [`lib/store.js`](lib/store.js) | Validation and atomic read/write of `network-config.json` |
| [`lib/text.js`](lib/text.js) | Host-side diagnostic copy |
| [`client/client.js`](client/client.js) | Browser half: one packaged `window.__ModuleLoader__` module registering the page into `settings.section` |
| [`install.ps1`](install.ps1) / [`verify.ps1`](verify.ps1) | Installer and post-restart verifier |
| [`build-package.ps1`](build-package.ps1) | Builds the portable zip |
| [`test/`](test) | 39 unit tests |

The plugin's HTTP routes are fenced like the harness's own plugin routes: the
`Host` header must be loopback and a browser-marked `cross-site` request is
refused. That is a DNS-rebinding defense, not authentication.

## Known limitations

- **No SOCKS and no PAC.** The transport accepts `http(s)://` proxy URLs only. A
  system configured with a PAC script (`AutoConfigURL`) is reported and treated as
  direct rather than pretending to work.
- **`proxyRouteFor()` uses the package's narrower matcher.** Because the official
  policy is installed as-is, `dsh-web-fetch-http` decides whether to *fetch* through
  the proxy with that matcher — so fetching an **intranet** URL can still be routed
  through the proxy. Public fetches are unaffected. Traffic (models, search, MCP)
  goes through this plugin's matcher.
- **Child processes follow the policy only on Node 22.21+/24+.** That is
  `dsh-http-proxy`'s documented behaviour, driven by `NODE_USE_ENV_PROXY`. In
  *Direct* mode the plugin additionally clears `all_proxy`/`ALL_PROXY` so children
  do not keep using one.
- **Needs `undici` resolvable from inside the profile.** Without it the plugin falls
  back to the package's dispatcher and says so in the page — usable, but wildcard
  entries and private-address bypass stop applying.
- **Exclusive with other proxy plugins.** Whoever calls `setGlobalDispatcher` last
  wins; do not run this alongside e.g. `dsh-clash-proxy`.
- **System proxy discovery is Windows-only**; other platforms fall back to the
  environment.

## Development

```powershell
npm test          # or: node --test test/*.test.mjs
```

No build step, no dependencies. The browser half is a hand-written
`window.__ModuleLoader__` bundle and the tests load it exactly the way the client
does, then assert on the page's element tree — so no DOM or React renderer is needed.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

Not affiliated with DeepSeek. "DeepSeek Harness" refers to the upstream
application this plugin extends.
