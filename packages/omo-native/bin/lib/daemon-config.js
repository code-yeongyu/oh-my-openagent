import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

/**
 * Where `omo daemon` reads its config. Its `task.*` keys (`host_engine_policy`, `host_idle_exit_ms`) come
 * from the omo-config-core loader (~/.omo/omo.jsonc or ~/.omo/omo.json plus project `.omo` layers, JSONC,
 * the precedence every other `task.*` key has), reached through the staged
 * `plugin/runtime/task-config/index.js` bundle (task-config-entry.ts). `<agentDir>/omo.json` is the
 * deprecated source: it still supplies a key when the loader finds none for it.
 *
 * Fail-open: a payload without the runtime, or any error inside it, reads exactly the legacy file.
 */

export const TASK_CONFIG_RUNTIME = join("runtime", "task-config", "index.js")

const requireRuntime = createRequire(import.meta.url)
const POLICIES = new Set(["upgrade", "fallback", "never"])

/** Each key `omo daemon` reads, with the check its consumer applies (resolvePolicy, hostCommandEnvironment). */
const DAEMON_KEYS = {
  host_engine_policy: (value) => POLICIES.has(value),
  host_idle_exit_ms: (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
}

function loadTaskConfigRuntime(pluginRoot) {
  return requireRuntime(join(pluginRoot, TASK_CONFIG_RUNTIME))
}

/** The legacy file is optional and may be hand-edited, so unreadable config must not take the CLI down. */
function readLegacyConfig(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function loaderSettings(options) {
  try {
    const runtime = (options.loadRuntime ?? loadTaskConfigRuntime)(options.pluginRoot)
    return { available: true, settings: runtime.resolveDaemonTaskSettings({ cwd: options.cwd ?? process.cwd(), env: options.env }) }
  } catch {
    return { available: false, settings: {} }
  }
}

/**
 * @param options.pluginRoot the staged plugin dir the runtime is loaded from
 * @param options.agentDir the dir holding the deprecated omo.json
 * @param options.env / options.cwd where the loader looks up the user and project layers
 * @param options.loadRuntime injected so tests never need the staged payload
 * @returns {{ config: object | undefined, legacyPath: string, legacySources: { key: string, value: unknown }[] }}
 *   `legacySources` lists the keys the deprecated file supplied while the loader ran and set none of them
 */
export function readDaemonConfig(options) {
  const legacyPath = join(options.agentDir, "omo.json")
  const legacy = readLegacyConfig(legacyPath)
  const loaded = loaderSettings(options)
  const fromLoader = Object.keys(DAEMON_KEYS).filter((key) => loaded.settings[key] !== undefined)
  const legacySources = loaded.available
    ? Object.entries(DAEMON_KEYS)
        .filter(([key, usable]) => loaded.settings[key] === undefined && usable(legacy?.task?.[key]))
        .map(([key]) => ({ key, value: legacy.task[key] }))
    : []
  if (fromLoader.length === 0) return { config: legacy, legacyPath, legacySources }
  const task = { ...legacy?.task }
  for (const key of fromLoader) task[key] = loaded.settings[key]
  return { config: { ...legacy, task }, legacyPath, legacySources }
}

/**
 * Moving a legacy value into omo.jsonc must not change what the daemon does, and the config schema takes
 * only `upgrade|fallback` and whole milliseconds, so values it would reject get the advice that keeps them.
 */
function migrationAdvice({ key, value }) {
  if (key === "host_engine_policy" && value === "never") {
    return '"never" is a command-line policy only (the config key accepts upgrade|fallback); pass --no-upgrade instead'
  }
  if (key === "host_idle_exit_ms" && !Number.isInteger(value)) return "move it to ~/.omo/omo.jsonc as whole milliseconds"
  return "move it to ~/.omo/omo.jsonc"
}

/** One doctor line per key the deprecated file supplied; none when the loader supplies them or cannot run. */
export function daemonConfigDoctorLines(options) {
  const { legacyPath, legacySources } = readDaemonConfig(options)
  return legacySources.map((source) => `WARN task.${source.key}: read from deprecated ${legacyPath}; ${migrationAdvice(source)}`)
}
