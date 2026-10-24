import { readdirSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

// The opted-out side of session_summary, kept in the entry bundle with node:fs only: turning telemetry off
// must delete what earlier runs queued without loading any telemetry code (the recorder lives in a sidecar).

type QueuedScope = { readonly cwd?: string }

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
    const key = scope.cwd ?? ""
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
  return isScopeConsented({ cwd })
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
