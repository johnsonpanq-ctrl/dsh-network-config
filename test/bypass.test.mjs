/**
 * Bypass-matcher tests.
 *
 * These are the cases the harness's own matcher gets wrong: the entry forms
 * Windows writes into `ProxyOverride` (prefix wildcards such as `192.168.*`)
 * and the private addresses a forward proxy cannot reach. Each case is stated
 * with the destination it protects.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compileBypass,
  ipv4ToInt,
  isIpv4,
  isPrivateHost,
  proxyForRequest,
} from '../lib/bypass.js'

/** Shorthand for one route decision. */
function route(policy, target, list = '') {
  return proxyForRequest(policy, new URL(target), compileBypass(list))
}

test('ipv4ToInt parses dotted quads and rejects everything else', () => {
  assert.equal(ipv4ToInt('192.168.1.10'), 0xc0a8010a)
  assert.equal(ipv4ToInt('0.0.0.0'), 0)
  assert.equal(ipv4ToInt('255.255.255.255'), 4294967295)
  assert.equal(ipv4ToInt('256.1.1.1'), undefined)
  assert.equal(ipv4ToInt('1.2.3'), undefined)
  assert.equal(ipv4ToInt('a.b.c.d'), undefined)
  assert.equal(isIpv4('10.0.0.1'), true)
  assert.equal(isIpv4('10.0.0'), false)
})

test('private addresses stay direct: loopback, RFC1918, link-local, CGNAT', () => {
  for (const host of [
    '127.0.0.1', '127.9.9.9', '10.0.0.5', '172.16.4.4', '172.31.255.254',
    '172.20.0.10', '169.254.1.1', '100.64.0.10', '100.64.0.1', '0.0.0.0',
    'localhost', 'myhost.localhost', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '::ffff:192.168.1.1',
  ]) {
    assert.equal(isPrivateHost(host), true, `${host} must be private`)
  }
  for (const host of ['8.8.8.8', '100.63.255.255', '100.128.0.1', '172.32.0.1', '192.169.0.1', 'example.com']) {
    assert.equal(isPrivateHost(host), false, `${host} must be public`)
  }
})

test('a Windows prefix wildcard entry actually bypasses', () => {
  const list = compileBypass('192.168.*,10.*,172.16.*')
  assert.equal(list.matches('172.20.0.10', '8080'), true)
  assert.equal(list.matches('192.168.0.1', '80'), true)
  assert.equal(list.matches('10.1.2.3', '443'), true)
  assert.equal(list.matches('172.16.0.9', '80'), true)
  assert.equal(list.matches('172.17.0.9', '80'), false)
  assert.equal(list.matches('192.169.0.1', '80'), false)
  assert.equal(list.matches('api.example.com', '443'), false)
})

test('a CIDR entry actually bypasses', () => {
  const list = compileBypass('10.0.0.0/8,192.168.0.0/16,100.64.0.0/10,172.16.0.0/12')
  assert.equal(list.matches('10.255.255.255', '80'), true)
  assert.equal(list.matches('11.0.0.1', '80'), false)
  assert.equal(list.matches('192.168.1.1', '80'), true)
  assert.equal(list.matches('192.169.1.1', '80'), false)
  assert.equal(list.matches('100.64.0.10', '8080'), true)
  assert.equal(list.matches('100.128.0.1', '80'), false)
  assert.equal(list.matches('172.15.0.1', '80'), false)
  assert.equal(list.matches('172.16.0.1', '80'), true)
  assert.equal(list.matches('172.32.0.1', '80'), false)
})

test('<local> bypasses a name without a dot, not an address', () => {
  const list = compileBypass('<local>')
  assert.equal(list.matches('intranet', '80'), true)
  assert.equal(list.matches('intranet.corp', '80'), false)
  assert.equal(list.matches('192.168.1.1', '80'), false)
})

test('host entries match the host and its subdomains, with optional ports', () => {
  const list = compileBypass('example.com,*.corp.example,api.test:8443')
  assert.equal(list.matches('example.com', '443'), true)
  assert.equal(list.matches('api.example.com', '443'), true)
  assert.equal(list.matches('notexample.com', '443'), false)
  assert.equal(list.matches('a.corp.example', '443'), true)
  assert.equal(list.matches('corp.example', '443'), true)
  assert.equal(list.matches('api.test', '8443'), true)
  assert.equal(list.matches('api.test', '443'), false)
})

test('a star entry bypasses everything and reports its size', () => {
  const list = compileBypass('*')
  assert.equal(list.all, true)
  assert.equal(list.matches('anything.example', '80'), true)
  assert.equal(compileBypass('a,b,c').size, 3)
  assert.equal(compileBypass('').size, 0)
})

test('the real Windows bypass list keeps every LAN endpoint on this machine direct', () => {
  const windows = 'localhost,127.*,192.168.*,10.*,172.16.*,172.17.*,172.18.*,172.19.*,172.20.*,172.21.*,172.22.*,172.23.*,172.24.*,172.25.*,172.26.*,172.27.*,172.28.*,172.29.*,172.30.*,172.31.*'
  const list = compileBypass(windows)
  assert.equal(list.matches('127.0.0.1', '8080'), true)
  assert.equal(list.matches('172.20.0.10', '8080'), true)
  assert.equal(list.matches('10.0.0.9', '80'), true)
  assert.equal(list.matches('172.24.1.1', '80'), true)
  assert.equal(list.matches('8.8.8.8', '443'), false)
})

test('proxyForRequest combines the scheme proxy, the bypass list, and private hosts', () => {
  const policy = { httpProxy: 'http://127.0.0.1:7897', httpsProxy: 'http://127.0.0.1:7897' }
  assert.equal(route(policy, 'https://example.com/'), 'http://127.0.0.1:7897')
  assert.equal(route(policy, 'https://example.com/', 'example.com'), undefined)
  // The address no Windows entry covers: still direct because a proxy cannot reach it.
  assert.equal(route(policy, 'http://100.64.0.10:8080/v1/models'), undefined)
  assert.equal(route(policy, 'http://172.20.0.10:8080/v1/models'), undefined)
  assert.equal(route(policy, 'http://127.0.0.1:8080/v1/models'), undefined)
  // A public address without a bypass entry still goes through the proxy.
  assert.equal(route(policy, 'https://api.deepseek.com/v1'), 'http://127.0.0.1:7897')
  // A non-http scheme is never proxied.
  assert.equal(route(policy, 'ws://example.com/socket'), undefined)
})

test('an https request uses the https proxy and its default port in bypass matching', () => {
  const policy = { httpProxy: 'http://a:1', httpsProxy: 'http://b:2' }
  assert.equal(route(policy, 'https://example.com/'), 'http://b:2')
  assert.equal(route(policy, 'http://example.com/'), 'http://a:1')
  assert.equal(route(policy, 'https://example.com/', 'example.com:443'), undefined)
  assert.equal(route(policy, 'https://example.com/', 'example.com:80'), 'http://b:2')
})
