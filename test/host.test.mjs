/**
 * Host-half unit tests: the registry parser, the mode table, and the settings
 * document. No harness process, no network, no Windows required — every case
 * feeds the pure functions a recorded input.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  NetworkStore,
  defaultConfig,
  isSupportedProxyUrl,
  normalizeConfig,
  validateSubmission,
} from '../lib/store.js'
import {
  clearProxyEnvironment,
  resolvePolicy,
  toPolicyEnvironment,
} from '../lib/policy.js'
import {
  fromEnvironment,
  interpretRegistry,
  parseProxyOverride,
  parseProxyServer,
  parseRegistryQuery,
  readSystemProxy,
} from '../lib/system-proxy.js'
import { compileBypass } from '../lib/bypass.js'

/** A recorded `reg query` output for the Internet Settings key. */
const REGISTRY_SAMPLE = [
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
  '    ProxyEnable    REG_DWORD    0x1',
  '    ProxyServer    REG_SZ    127.0.0.1:7897',
  '    ProxyOverride    REG_SZ    <local>;*.local;10.0.0.0/8',
  '    AutoConfigURL    REG_SZ    (value not set)',
  '',
].join('\r\n')

test('parseRegistryQuery reads REG_DWORD as a number and REG_SZ as text', () => {
  const values = parseRegistryQuery(REGISTRY_SAMPLE)
  assert.equal(values.ProxyEnable, 1)
  assert.equal(values.ProxyServer, '127.0.0.1:7897')
  assert.equal(values.ProxyOverride, '<local>;*.local;10.0.0.0/8')
  assert.equal('AutoConfigURL' in values, false)
})

test('interpretRegistry turns an enabled single-server proxy into both schemes', () => {
  const system = interpretRegistry(REGISTRY_SAMPLE)
  assert.equal(system.source, 'registry')
  assert.equal(system.enabled, true)
  assert.equal(system.http, 'http://127.0.0.1:7897/')
  assert.equal(system.https, 'http://127.0.0.1:7897/')
  // Every entry survives: `<local>` and the CIDR form are the ones carrying
  // the "keep local traffic direct" intent, and the plugin's matcher
  // implements them instead of dropping them.
  assert.equal(system.bypass, '<local>,*.local,10.0.0.0/8')
})

test('interpretRegistry reports a disabled proxy as disabled even with a server', () => {
  const system = interpretRegistry([
    '    ProxyEnable    REG_DWORD    0x0',
    '    ProxyServer    REG_SZ    127.0.0.1:7897',
    '',
  ].join('\r\n'))
  assert.equal(system.enabled, false)
  assert.equal(system.http, undefined)
})

test('interpretRegistry surfaces a PAC script that has no server', () => {
  const system = interpretRegistry([
    '    ProxyEnable    REG_DWORD    0x1',
    '    AutoConfigURL    REG_SZ    http://proxy.example/proxy.pac',
    '',
  ].join('\r\n'))
  assert.equal(system.enabled, true)
  assert.equal(system.pac, 'http://proxy.example/proxy.pac')
  assert.equal(system.http, undefined)
})

test('parseProxyServer splits a per-scheme list and drops SOCKS', () => {
  const parsed = parseProxyServer('http=10.0.0.1:8080;https=10.0.0.1:8443;socks=10.0.0.1:1080')
  assert.equal(parsed.http, 'http://10.0.0.1:8080/')
  assert.equal(parsed.https, 'http://10.0.0.1:8443/')
})

test('parseProxyServer rejects an unusable value instead of throwing', () => {
  assert.deepEqual(parseProxyServer(''), {})
  assert.deepEqual(parseProxyServer('http://[not a host'), {})
})

test('parseProxyOverride keeps every entry the operating system wrote', () => {
  assert.deepEqual(
    parseProxyOverride('<local>;*.corp.example;192.168.0.0/16;*.corp.example'),
    { list: '<local>,*.corp.example,192.168.0.0/16', entries: ['<local>', '*.corp.example', '192.168.0.0/16'] },
  )
  assert.deepEqual(parseProxyOverride(''), { list: '', entries: [] })
})

test('fromEnvironment falls back to ALL_PROXY and derives https from http', () => {
  const system = fromEnvironment({ all_proxy: 'http://127.0.0.1:7890' })
  assert.equal(system.enabled, true)
  assert.equal(system.http, 'http://127.0.0.1:7890')
  assert.equal(system.https, 'http://127.0.0.1:7890')
  assert.equal(system.source, 'env')
})

test('readSystemProxy falls back to the environment when the registry fails', async () => {
  const system = await readSystemProxy({
    platform: 'win32',
    env: { HTTPS_PROXY: 'http://10.1.2.3:3128' },
    run: async () => { throw new Error('reg.exe missing') },
  })
  assert.equal(system.source, 'env')
  assert.equal(system.https, 'http://10.1.2.3:3128')
  assert.match(system.registryError, /reg\.exe missing/)
})

test('readSystemProxy uses the registry result on Windows', async () => {
  const system = await readSystemProxy({
    platform: 'win32',
    env: {},
    run: async () => REGISTRY_SAMPLE,
  })
  assert.equal(system.source, 'registry')
  assert.equal(system.https, 'http://127.0.0.1:7897/')
})

test('resolvePolicy maps direct mode to no proxy at all', () => {
  const resolved = resolvePolicy({ mode: 'direct', custom: { proxy: '', bypass: '' } }, undefined)
  assert.equal(resolved.direct, true)
  assert.equal(resolved.httpProxy, undefined)
  assert.equal(resolved.httpsProxy, undefined)
  assert.deepEqual(toPolicyEnvironment(resolved).size, 0)
})

test('resolvePolicy maps custom mode to both schemes plus the bypass list', () => {
  const resolved = resolvePolicy(
    { mode: 'custom', custom: { proxy: 'http://127.0.0.1:7890', bypass: 'localhost,.corp' } },
    undefined,
  )
  assert.equal(resolved.direct, false)
  assert.equal(resolved.httpProxy, 'http://127.0.0.1:7890')
  assert.equal(resolved.httpsProxy, 'http://127.0.0.1:7890')
  const env = toPolicyEnvironment(resolved)
  assert.equal(env.get('http_proxy').value, 'http://127.0.0.1:7890')
  assert.equal(env.get('HTTPS_PROXY').value, 'http://127.0.0.1:7890')
  assert.equal(env.get('no_proxy').value, 'localhost,.corp')
})

test('resolvePolicy refuses a custom proxy that is not http(s)', () => {
  const resolved = resolvePolicy({ mode: 'custom', custom: { proxy: 'socks5://127.0.0.1:1080', bypass: '' } }, undefined)
  assert.equal(resolved.direct, true)
  assert.match(resolved.diagnostics.join(' '), /不可用/)
})

test('resolvePolicy consumes the system discovery result and keeps its whole bypass list', () => {
  const system = interpretRegistry(REGISTRY_SAMPLE)
  const resolved = resolvePolicy({ mode: 'system', custom: { proxy: '', bypass: '' } }, system)
  assert.equal(resolved.httpProxy, 'http://127.0.0.1:7897/')
  assert.equal(resolved.noProxy, '<local>,*.local,10.0.0.0/8')
  assert.equal(resolved.direct, false)
  // The entry forms that used to be dropped now reach the matcher.
  const bypass = compileBypass(resolved.noProxy)
  assert.equal(bypass.matches('10.1.2.3', '80'), true)
  assert.equal(bypass.matches('intranet', '80'), true)
  assert.equal(bypass.matches('api.local', '80'), true)
  assert.equal(bypass.matches('10.example.com', '443'), false)
})

test('resolvePolicy explains a PAC-only system configuration', () => {
  const system = interpretRegistry([
    '    ProxyEnable    REG_DWORD    0x1',
    '    AutoConfigURL    REG_SZ    http://proxy.example/proxy.pac',
    '',
  ].join('\r\n'))
  const resolved = resolvePolicy({ mode: 'system', custom: { proxy: '', bypass: '' } }, system)
  assert.equal(resolved.direct, true)
  assert.match(resolved.diagnostics.join(' '), /PAC/)
})

test('clearProxyEnvironment removes every proxy name it owns', () => {
  const env = { http_proxy: 'a', HTTP_PROXY: 'b', all_proxy: 'c', PATH: '/bin' }
  clearProxyEnvironment(env)
  assert.deepEqual(env, { PATH: '/bin' })
})

test('isSupportedProxyUrl accepts only absolute http(s) URLs', () => {
  assert.equal(isSupportedProxyUrl('http://127.0.0.1:7890'), true)
  assert.equal(isSupportedProxyUrl('https://proxy.example'), true)
  assert.equal(isSupportedProxyUrl('127.0.0.1:7890'), false)
  assert.equal(isSupportedProxyUrl('socks5://127.0.0.1:1080'), false)
  assert.equal(isSupportedProxyUrl(''), false)
  assert.equal(isSupportedProxyUrl(undefined), false)
})

test('normalizeConfig falls back per field instead of throwing', () => {
  assert.deepEqual(normalizeConfig(null), defaultConfig())
  assert.deepEqual(
    normalizeConfig({ mode: 'nonsense', custom: { proxy: 42 } }),
    { version: 1, mode: 'system', custom: { proxy: '', bypass: '' } },
  )
  assert.deepEqual(
    normalizeConfig({ mode: 'custom', custom: { proxy: ' http://a:1 ', bypass: ' x ' } }),
    { version: 1, mode: 'custom', custom: { proxy: 'http://a:1', bypass: 'x' } },
  )
})

test('validateSubmission refuses an unknown mode and a bad custom proxy', () => {
  assert.equal(validateSubmission({ mode: 'wat' }).ok, false)
  assert.equal(validateSubmission({ mode: 'custom', custom: { proxy: 'nope' } }).ok, false)
  assert.equal(validateSubmission({ mode: 'custom', custom: { proxy: 'http://127.0.0.1:7890' } }).ok, true)
  assert.equal(validateSubmission({ mode: 'direct' }).ok, true)
})

test('NetworkStore round-trips atomically and tolerates a corrupt document', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-network-config-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'network-config.json')

  const store = new NetworkStore(path)
  assert.deepEqual(await store.load(), defaultConfig())

  await store.save({ mode: 'custom', custom: { proxy: 'http://127.0.0.1:7890', bypass: 'localhost' } })
  const written = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(written.mode, 'custom')
  assert.equal(written.custom.proxy, 'http://127.0.0.1:7890')

  const reloaded = new NetworkStore(path)
  assert.equal((await reloaded.load()).mode, 'custom')

  await writeFile(path, '{ not json', 'utf8')
  const broken = new NetworkStore(path)
  assert.deepEqual(await broken.load(), defaultConfig())
})

test('NetworkStore serializes overlapping saves', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-network-config-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'network-config.json')
  const store = new NetworkStore(path)
  await Promise.all([
    store.save({ mode: 'direct' }),
    store.save({ mode: 'custom', custom: { proxy: 'http://127.0.0.1:1', bypass: '' } }),
  ])
  const written = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(written.mode, 'custom')
})
