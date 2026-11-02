import { readdirSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

// The opted-out side of session_summary, kept in the entry bundle with node:fs only: turning telemetry off
// must delete what earlier runs queued without loading any telemetry code (the recorder lives in a sidecar).

/** Env keys that pick which config a process reads (a profile, a config dir, a home): per-process choices. */
export const CONFIG_SELECTION_ENV_KEYS = ["OMO_PROFILE", "OCX_PROFILE", "OPENCODE_CONFIG_DIR", "HOME", "USERPROFILE"] as const

/**
 * The config selection a record's writer consented under. Stored with the record's scope so that a reader judges
 * the record by the writer's own config (its profile included), never by the reader's (#11198).
 */
export type ConfigSelection = Readonly<Partial<Record<(typeof CONFIG_SELECTION_ENV_KEYS)[number], string>>>

export function configSelectionOf(env: Readonly<Record<string, string | undefined>>): ConfigSelection {
  const selection: Partial<Record<(typeof CONFIG_SELECTION_ENV_KEYS)[number], string>> = {}
  for (const key of CONFIG_SELECTION_ENV_KEYS) {
    const value = env[key]
    if (typeof value === "string" && value.length > 0) selection[key] = value
  }
  return selection
}

export function parseConfigSelection(value: unknown): ConfigSelection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const selection: Partial<Record<(typeof CONFIG_SELECTION_ENV_KEYS)[number], string>> = {}
  for (const key of CONFIG_SELECTION_ENV_KEYS) {
    const entry: unknown = Reflect.get(value, key)
    if (entry === undefined) continue
    if (typeof entry !== "string" || entry.length === 0) return undefined
    selection[key] = entry
  }
  return selection
}

/**
 * `env` with its config selection replaced by a record's: the keys of `CONFIG_SELECTION_ENV_KEYS` are taken from
 * `selection` only, every other key (the env opt-outs included) stays this process's own.
 */
export function withConfigSelection(
  env: Readonly<Record<string, string | undefined>>,
  selection: ConfigSelection,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env }
  for (const key of CONFIG_SELECTION_ENV_KEYS) delete out[key]
  return Object.assign(out, selection)
}

type QueuedScope = { readonly cwd?: string; readonly config?: ConfigSelection }

/** `<state>/session-summary`: windows at the top, events awaiting delivery under `pending/`. */
export function summaryDir(stateDir: string): string {
  return join(stateDir, "session-summary")
}

/** True when `<state>/session-summary` holds any entry. */
export function hasQueuedSummaryFiles(stateDir: string): boolean {
  return names(summaryDir(stateDir)).length > 0
}

/**
 * Deletes every queued window and pending event that may never be sent: no `enabled` consent mark, or a scope
 * whose PERSISTED consent (the config files every process reads), read now, is off. It only reads and deletes,
 * never writes. An opt-out set by environment variable belongs to one process, so it is never passed in here:
 * other sessions that consented keep their windows and pending events.
 */
export function purgeUnconsentedQueue(
  stateDir: string,
  isScopeConsented: (scope: QueuedScope) => boolean,
  options: { readonly dropUnreadable?: boolean } = {},
): void {
  const dir = summaryDir(stateDir)
  // One persisted-setting read per cwd per pass: a queue of many records from one project loads its config once.
  const verdicts = new Map<string, boolean>()
  const consented = (scope: QueuedScope): boolean => {
    const config = scope.config === undefined ? "" : JSON.stringify(CONFIG_SELECTION_ENV_KEYS.map((name) => scope.config?.[name] ?? null))
    const key = `${scope.cwd ?? ""}\u0000${config}`
    const known = verdicts.get(key)
    if (known !== undefined) return known
    const verdict = isScopeConsented(scope)
    verdicts.set(key, verdict)
    return verdict
  }
  for (const folder of [dir, join(dir, "pending")]) {
    for (const name of names(folder)) {
      if (!name.endsWith(".json")) continue
      const path = join(folder, name)
      const verdict = sendable(read(path), consented)
      if (verdict === false || (verdict === undefined && options.dropUnreadable === true)) remove(path)
    }
  }
}

// A record parses to its consent mark and scope. An unreadable or unknown-version file is never sendable either;
// it is deleted when the caller's own persisted setting is off (dropUnreadable), else left for the recorder's sweep.
function sendable(value: unknown, isScopeConsented: (scope: QueuedScope) => boolean): boolean | undefined {
  if (typeof value !== "object" || value === null || Reflect.get(value, "v") !== 2) return undefined
  if (Reflect.get(value, "consent") !== "enabled") return false
  const scope: unknown = Reflect.get(value, "scope")
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) return false
  const cwd: unknown = Reflect.get(scope, "cwd")
  // A record that names no cwd fails closed, as at send time (isRecordSendable): consent read without a cwd would
  // be this process's default, not the writer's.
  if (typeof cwd !== "string" || cwd.length === 0) return false
  const rawConfig: unknown = Reflect.get(scope, "config")
  if (rawConfig === undefined) return isScopeConsented({ cwd })
  const config = parseConfigSelection(rawConfig)
  // A selection that cannot be read back cannot be judged: leave the record to the recorder's own reading.
  return config === undefined ? undefined : isScopeConsented({ cwd, config })
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function read(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function remove(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Already gone, or claimed by another process: nothing of it is sent either way.
  }
}
