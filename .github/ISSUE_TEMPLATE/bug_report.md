---
name: Bug report
about: Something routed wrong, or the page does not work
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- What you expected, and what you got instead. -->

## Which destination misbehaved

- URL (redact anything private if you need to):
- Is that address **private or public**? (loopback / 10.x / 172.16-31.x / 192.168.x /
  169.254.x / 100.64-127.x are private)
- Did it need the proxy, or need to bypass it?

## Your setup

- Harness version:
- Windows version:
- Mode selected: `Follow system` / `Direct` / `Custom`
- Proxy software, if any:

## verify.ps1 output

<!-- Paste the whole thing. It reports the effective route and probes both a
     private and a public address, which is usually enough to localise the bug. -->

```
powershell -ExecutionPolicy Bypass -File .\verify.ps1
```

```
(paste here)
```
