/**
 * Browser-half tests.
 *
 * The bundle is loaded exactly the way the client module system loads it —
 * one `window.__ModuleLoader__.load({ id, factory })` call — and the factory
 * is materialized with the platform modules it declares. No DOM and no React
 * renderer are involved: the page's element tree is produced by the pure
 * renderer the component wraps, so it can be inspected directly.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const BUNDLE = new URL('../client/client.js', import.meta.url)

/** `React.createElement`, reduced to a plain tree. */
function createElement(type, props, ...children) {
  const merged = Object.assign({}, props === null || props === undefined ? {} : props)
  if (children.length === 1) merged.children = children[0]
  else if (children.length > 1) merged.children = children
  return { type, props: merged }
}

/** Component names stand in for the primitives the page renders. */
const PRIMITIVES = {
  Button: 'Button',
  SegmentedControl: 'SegmentedControl',
  SettingsValueField: 'SettingsValueField',
  SettingsForm: 'SettingsForm',
}

/**
 * Re-materialize a value from the bundle's realm.
 *
 * Everything the factory builds lives in the `vm` context, so its arrays and
 * objects have that realm's prototypes; `assert/strict` compares prototypes
 * and would reject structurally identical values.
 *
 * @param value - a value produced inside the bundle's context.
 * @returns the same value rebuilt in this realm.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Evaluate the bundle and hand back its materialized module.
 * @param language - what the shell declares as the interface language.
 * @returns the module exports plus the captured registration.
 */
function loadBundle(language = 'zh-CN') {
  const source = readFileSync(BUNDLE, 'utf8')
  let definition
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { definition = value } } },
    document: { documentElement: { getAttribute: () => language } },
    navigator: { language },
    console,
    Symbol,
    URL,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.equal(definition.id, 'dsh-network-config')
  const module = definition.factory((specifier) => {
    if (specifier === 'react') return { createElement }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return PRIMITIVES
    throw new Error(`unexpected require: ${specifier}`)
  })
  return module
}

/** Depth-first search for the first element of one type. */
function find(node, type) {
  if (node === null || node === undefined) return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (typeof node !== 'object') return undefined
  if (node.type === type) return node
  return find(node.props ? node.props.children : undefined, type)
}

/** Collect every element of one type. */
function findAll(node, type, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, type, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (node.type === type) out.push(node)
  findAll(node.props ? node.props.children : undefined, type, out)
  return out
}

/** The state payload the host answers with. */
function readyState() {
  return {
    ok: true,
    state: {
      config: { version: 1, mode: 'system', custom: { proxy: '', bypass: '' } },
      storePath: 'C:/Users/x/.dsh/network-config.json',
      applied: { mode: 'system', direct: false, summary: 'http://127.0.0.1:7897/', noProxy: '*.local', at: 1 },
      diagnostics: [],
      lastError: null,
      system: { source: 'registry', enabled: true, server: '127.0.0.1:7897', pac: '', bypass: '*.local', bypassDropped: [] },
      probeUrl: 'https://www.deepseek.com/',
    },
  }
}

/** A view model for the pure renderer. */
function view(overrides = {}) {
  const state = readyState().state
  const noop = () => {}
  return Object.assign({
    t: loadBundle().__internals.texts(),
    phase: 'ready',
    remote: state,
    draft: { mode: 'system', custom: { proxy: '', bypass: '' } },
    saving: false,
    failed: false,
    notice: null,
    probing: false,
    probe: null,
    actions: { load: noop, setMode: noop, setCustom: noop, discard: noop, save: noop, probe: noop },
  }, overrides)
}

test('the bundle registers a client plugin whose label follows the interface language', () => {
  const module = loadBundle('zh-CN')
  assert.equal(module.name, 'dsh-network-config')
  assert.deepEqual(plain(module.inject), ['slots'])

  let registration
  let injectionKey
  const ctx = {
    slots: {
      inject: (key, callback) => {
        injectionKey = key
        callback()
      },
      register: (entry, component) => {
        registration = { entry, component }
        return () => {}
      },
    },
  }
  module.apply(ctx)
  assert.equal(injectionKey, 'settings.section')
  assert.equal(registration.entry.name, 'settings.section')
  assert.equal(registration.entry.id, 'network')
  assert.equal(registration.entry.order, 60)
  assert.equal(registration.entry.label(), '网络')
  assert.equal(typeof registration.component, 'function')

  const english = loadBundle('en-US')
  const englishCtx = {
    slots: {
      inject: (key, callback) => callback(),
      register: (entry) => {
        assert.equal(entry.label(), 'Network')
        return () => {}
      },
    },
  }
  english.apply(englishCtx)
})

test('the pure helpers decide proxy validity, dirtiness, and route text', () => {
  const { isProxyUrl, draftOf, isDirty, routeText, systemText } = loadBundle().__internals
  const t = loadBundle().__internals.texts()

  assert.equal(isProxyUrl('http://127.0.0.1:7890'), true)
  assert.equal(isProxyUrl('socks5://127.0.0.1:1080'), false)
  assert.equal(isProxyUrl(''), false)

  const config = { mode: 'system', custom: { proxy: '', bypass: '' } }
  assert.deepEqual(plain(draftOf(config)), { mode: 'system', custom: { proxy: '', bypass: '' } })
  assert.equal(isDirty(draftOf(config), config), false)
  assert.equal(isDirty({ mode: 'direct', custom: { proxy: '', bypass: '' } }, config), true)
  assert.equal(isDirty({ mode: 'system', custom: { proxy: '', bypass: 'x' } }, config), true)

  assert.equal(routeText(t, null), t.routeUnknown)
  assert.equal(routeText(t, { direct: true }), t.routeDirect)
  assert.equal(routeText(t, { direct: false, summary: 'http://a:1/' }), 'http://a:1/')

  assert.equal(systemText(t, undefined), t.systemSkipped)
  assert.equal(systemText(t, { enabled: false }), t.systemDisabled)
  assert.equal(systemText(t, { enabled: true, server: '127.0.0.1:7897' }), '已启用 · 127.0.0.1:7897')
})

test('the page renders a loading state before the host answers', () => {
  const tree = loadBundle().__internals.renderNetworkPage(view({ phase: 'loading', remote: null, draft: null }))
  assert.equal(tree.type, 'p')
  assert.equal(tree.props.role, 'status')
})

test('the page renders a retry state when the host is unreachable', () => {
  const tree = loadBundle().__internals.renderNetworkPage(
    view({ phase: 'error', remote: null, draft: null, notice: 'boom' }),
  )
  assert.equal(find(tree, 'Button').props.children, '重试')
  assert.match(find(tree, 'p').props.children, /boom/)
})

test('the follow-system page shows the mode control and the resolved route', () => {
  const tree = loadBundle().__internals.renderNetworkPage(view())
  const form = find(tree, 'SettingsForm')
  assert.equal(form.props.state.available, true)
  assert.equal(form.props.state.dirty, false)
  assert.equal(form.props.state.invalid, false)

  const segmented = find(tree, 'SegmentedControl')
  assert.equal(segmented.props.value, 'system')
  assert.deepEqual(plain(segmented.props.options).map((option) => option.value), ['system', 'direct', 'custom'])

  const text = JSON.stringify(tree)
  assert.match(text, /当前生效/)
  assert.match(text, /127\.0\.0\.1:7897/)
  assert.equal(findAll(tree, 'SettingsValueField').length, 0)
})

test('the custom page exposes the proxy and bypass fields and blocks a bad URL', () => {
  const bad = loadBundle().__internals.renderNetworkPage(view({
    draft: { mode: 'custom', custom: { proxy: 'not-a-url', bypass: '' } },
  }))
  const fields = findAll(bad, 'SettingsValueField')
  assert.equal(fields.length, 2)
  assert.equal(fields[0].props.id, 'dsh-network-proxy')
  assert.equal(fields[0].props.invalid, true)
  assert.equal(find(bad, 'SettingsForm').props.state.invalid, true)
  assert.equal(find(bad, 'SettingsForm').props.state.dirty, true)

  const good = loadBundle().__internals.renderNetworkPage(view({
    draft: { mode: 'custom', custom: { proxy: 'http://127.0.0.1:7890', bypass: 'localhost' } },
  }))
  assert.equal(findAll(good, 'SettingsValueField')[0].props.invalid, false)
  assert.equal(find(good, 'SettingsForm').props.state.invalid, false)
})

test('the page surfaces diagnostics, a probe result, and the direct route', () => {
  const state = readyState().state
  const tree = loadBundle().__internals.renderNetworkPage(view({
    remote: Object.assign({}, state, {
      applied: { mode: 'direct', direct: true, summary: 'direct', noProxy: '', at: 2 },
      diagnostics: ['系统绕过列表中的 10.0.0.0/8 无法被传输层匹配'],
    }),
    draft: { mode: 'direct', custom: { proxy: '', bypass: '' } },
    probe: { ok: true, status: 200, ms: 42 },
  }))
  const text = JSON.stringify(tree)
  assert.match(text, /直连/)
  assert.match(text, /10\.0\.0\.0\/8/)
  assert.match(text, /HTTP 200/)
  assert.equal(findAll(tree, 'SettingsValueField').length, 0)
})

test('the save button reports a failed save through the form state', () => {
  const tree = loadBundle().__internals.renderNetworkPage(view({
    failed: true,
    saving: false,
    notice: '自定义模式需要一个 http:// 或 https:// 代理地址。',
    draft: { mode: 'custom', custom: { proxy: 'http://127.0.0.1:7890', bypass: '' } },
  }))
  assert.equal(find(tree, 'SettingsForm').props.state.failed, true)
  assert.match(JSON.stringify(tree), /自定义模式需要一个/)
})
