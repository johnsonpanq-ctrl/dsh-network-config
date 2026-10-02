# Contributing

Thanks for taking a look. This is a small plugin; the bar is "does it work, is it
tested, does it stay honest about what it cannot do".

## Getting set up

No build step and no dependencies:

```powershell
git clone https://github.com/johnsonpanq-ctrl/dsh-network-config.git
cd dsh-network-config
npm test
```

To try a change against a real harness, install it into a **throwaway profile**
rather than your daily one:

```powershell
# create a disposable profile from the shipped web template
dsh --from-default-profile web --profile netdev --dump-config

# install this working copy into it
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile netdev

# boot it
dsh --profile netdev web --port 19500
powershell -ExecutionPolicy Bypass -File .\verify.ps1 -Base http://127.0.0.1:19500
```

## Tests

```powershell
npm test
```

Three suites, all plain `node:test` — no test framework, no DOM, no network:

| Suite | Covers |
|---|---|
| `test/bypass.test.mjs` | The matcher: wildcards, CIDR, `<local>`, suffixes, ports, private ranges |
| `test/host.test.mjs` | Registry output parsing, the mode table, the settings document |
| `test/client.test.mjs` | The browser bundle, loaded through `window.__ModuleLoader__` and asserted on its element tree |

`npm test` also runs `npm run check`, which guards the text itself:

- `tools/check-encoding.mjs` — fails on a U+FFFD replacement character or a UTF-8
  BOM. A corrupted write has landed in this repository before, and the result
  parses as Chinese, so it survives review; this catches it mechanically.
- `tools/check-links.mjs` — fails on a relative Markdown link whose target does
  not exist.

**Please add a case with any behaviour change.** The bypass tests are written as
"which destinations stay direct, and why" — a new entry form belongs there with the
destination it protects, not just the parse result.

## Translations

The README exists in English ([README.md](README.md)) and Chinese
([README.zh.md](README.zh.md)), and they are kept in sync by hand. If you change
one, change the other — a drift between them is worse than a missing translation.

## House rules

- **Keep the policy on the official channel.** Mode resolution is handed to
  `@deepseek-ai/dsh-http-proxy`; only the traffic-carrying dispatcher is this
  plugin's. Do not add a second, independent policy — the two would drift and
  `proxyRouteFor()` would start disagreeing with the dispatcher.
- **Never drop a bypass entry.** A silently discarded entry is a misrouted request;
  that bug is the reason this plugin exists. Unsupported input should be reported in
  the page, not ignored.
- **Do not claim what is not verified.** If a mode or a range is untested on a real
  harness, say so in the README's limitations instead of implying it works.
- **No runtime dependencies.** The plugin must keep working from a copy with no
  package manager involved.

## Pull requests

- One concern per PR; describe the problem before the fix.
- Run `npm test` and include the result.
- If you changed anything user-visible, update the README (and `INSTALL.md` when the
  install flow changes).
- Match the existing code style: no semicolons, single quotes, JSDoc on every
  exported function, comments that explain *why* rather than restating the code.

## Reporting a bug

Please include:

- your harness version and Windows version
- the mode you selected, and the output of
  `powershell -ExecutionPolicy Bypass -File .\verify.ps1`
- the destination that misbehaved, and whether it is public or private
