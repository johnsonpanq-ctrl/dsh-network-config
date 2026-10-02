/**
 * Durable store for this plugin's own settings document.
 *
 * The document is deliberately tiny and self-owned: the plugin must keep
 * working on a deployment whose settings service, config editor, or profile
 * patch is unavailable, and the network mode has to survive a restart even
 * when the profile itself is read-only.
 *
 * Everything in this module is transport-free and effect-free, so it is also
 * the unit-test surface for the persistence contract.
 *
 * @module dsh-network-config/store
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The three modes the settings page offers. */
export const MODES = ['system', 'direct', 'custom']

/** Document schema version written by this release. */
export const STORE_VERSION = 1

/** A pristine document: follow the operating system's proxy configuration. */
export function defaultConfig() {
  return { version: STORE_VERSION, mode: 'system', custom: { proxy: '', bypass: '' } }
}

/**
 * Resolve the settings document path.
 *
 * `$DSH_HOME` is the harness home the launcher exports; falling back to
 * `~/.dsh` keeps the plugin usable when it is loaded by something that did not
 * export it.
 *
 * @param env - environment to read (defaults to `process.env`).
 * @returns the absolute path of the JSON document.
 */
export function defaultStorePath(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'network-config.json')
}

/**
 * Validate one proxy URL the way the transport layer will.
 *
 * `@deepseek-ai/dsh-http-proxy` accepts only `http:` and `https:`; anything
 * else (SOCKS, PAC, a bare `host:port`) is reported and skipped there, so this
 * check exists to refuse the write up front instead of silently routing direct.
 *
 * @param value - the candidate proxy URL.
 * @returns true when the value is an absolute http(s) URL.
 */
export function isSupportedProxyUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Trim a value into a string, treating anything else as empty. */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Coerce an arbitrary stored value into a well-formed document.
 *
 * A malformed field falls back to its default rather than throwing: an
 * unreadable preference must never keep the agent from starting.
 *
 * @param raw - whatever was parsed from disk or sent over the wire.
 * @returns a fresh, always-valid document.
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const custom = source.custom !== null && typeof source.custom === 'object' && !Array.isArray(source.custom)
    ? source.custom
    : {}
  const mode = MODES.includes(source.mode) ? source.mode : 'system'
  return {
    version: STORE_VERSION,
    mode,
    custom: { proxy: text(custom.proxy), bypass: text(custom.bypass) },
  }
}

/**
 * Reject a document the user submitted when it cannot work.
 *
 * @param raw - the submitted document.
 * @returns `{ ok: true, config }` or `{ ok: false, reason }`.
 */
export function validateSubmission(raw) {
  const config = normalizeConfig(raw)
  if (raw !== null && typeof raw === 'object' && !MODES.includes(raw.mode)) {
    return { ok: false, reason: `mode must be one of ${MODES.join(', ')}` }
  }
  if (config.mode === 'custom' && !isSupportedProxyUrl(config.custom.proxy)) {
    return { ok: false, reason: 'custom mode needs an http:// or https:// proxy URL' }
  }
  return { ok: true, config }
}

/**
 * The plugin's settings document on disk.
 *
 * Reads are cached after the first successful load; writes are atomic
 * (temporary sibling + rename) so a crash mid-write cannot leave a truncated
 * document that the next boot would silently reset.
 */
export class NetworkStore {
  #path
  #config = defaultConfig()
  #loaded = false
  #queue = Promise.resolve()

  /** @param path - document path, usually {@link defaultStorePath}'s result. */
  constructor(path = defaultStorePath()) {
    this.#path = path
  }

  /** @returns the document path this store owns. */
  get path() {
    return this.#path
  }

  /** @returns the current in-memory document (a copy). */
  get config() {
    return normalizeConfig(this.#config)
  }

  /**
   * Load the document once, tolerating a missing or malformed file.
   * @returns the loaded document.
   */
  async load() {
    if (this.#loaded) return this.config
    try {
      const parsed = JSON.parse(await readFile(this.#path, 'utf8'))
      this.#config = normalizeConfig(parsed)
    } catch {
      this.#config = defaultConfig()
    }
    this.#loaded = true
    return this.config
  }

  /**
   * Persist a document and adopt it in memory.
   *
   * Writes are serialized on one chain so two overlapping saves cannot
   * interleave their temporary files.
   *
   * @param next - the document to store.
   * @returns the stored (normalized) document.
   */
  async save(next) {
    const config = normalizeConfig(next)
    this.#queue = this.#queue.then(async () => {
      const temporary = `${this.#path}.${process.pid}.tmp`
      await mkdir(dirname(this.#path), { recursive: true })
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
      await rename(temporary, this.#path)
      this.#config = config
      this.#loaded = true
    })
    await this.#queue
    return this.config
  }
}
