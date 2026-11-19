import { closeSync, fstatSync, openSync, readSync } from "node:fs"

import { findDiskSessions } from "../address-book"
import { SESSION_CLOSED_ENTRY } from "../gateway/graceful-close-returns"
import { parseSessionLines, SESSION_FACTS_WINDOW_BYTES, summarizeSessionEntries } from "../session-facts"

/** `unknown`: a header this classifier cannot read, or a `kind` this build does not know. Never woken. */
export type WakeSessionKind = "interactive" | "child" | "worker" | "unknown"

export type WakeTarget =
  | { readonly kind: "gone" }
  | { readonly kind: "ambiguous"; readonly session_paths: readonly string[] }
  | {
      readonly kind: "found"
      readonly session_path: string
      readonly cwd: string
      readonly session_kind: WakeSessionKind
      /**
       * When the session was last closed on request (#14273): the newest unload its transcript records as done, in ms on
       * this device's clock. Absent when the transcript's tail records none (never closed that way, or by an omo that
       * sent no effect id).
       */
      readonly closed_at?: number
    }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function headerOf(path: string): Record<string, unknown> | null {
  let fd: number
  try {
    fd = openSync(path, "r")
  } catch {
    return null
  }
  try {
    const buffer = Buffer.alloc(SESSION_FACTS_WINDOW_BYTES)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return summarizeSessionEntries(parseSessionLines(buffer.subarray(0, read).toString("utf8"), false, true)).header
  } finally {
    closeSync(fd)
  }
}

/** senpi's transcript entry for a non-input effect (`effect-record.ts` `RPC_EFFECT_ENTRY`); an unload is one. */
const RPC_EFFECT_ENTRY = "rpc_effect"

/**
 * The newest `unload_session` the session's transcript tail records as done (#14273): senpi writes the effect of an
 * unload that carries an `effectId` (the close ladder sends one) to the transcript before it tears the session down, so
 * the holder knows the session was closed on request, and when, whichever device asked. An idle park writes nothing.
 */
/**
 * When one transcript entry records a close on request: an `rpc_effect` unload in state `done` (#14273), or the
 * `session-closed` record a graceful close writes (omo#14313), which a terminal's own close leaves without an effect.
 */
function closeInstantOf(customType: unknown, data: Record<string, unknown>): number | undefined {
  const stamp =
    customType === RPC_EFFECT_ENTRY
      ? data["kind"] === "unload" && data["state"] === "done"
        ? data["updatedAt"]
        : undefined
      : customType === SESSION_CLOSED_ENTRY
        ? data["at"]
        : undefined
  return typeof stamp === "string" ? Date.parse(stamp) : undefined
}

function closedAtOf(path: string): number | undefined {
  let fd: number
  try {
    fd = openSync(path, "r")
  } catch {
    return undefined
  }
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - SESSION_FACTS_WINDOW_BYTES)
    const buffer = Buffer.alloc(size - start)
    const read = readSync(fd, buffer, 0, buffer.length, start)
    let closedAt: number | undefined
    for (const entry of parseSessionLines(buffer.subarray(0, read).toString("utf8"), start > 0)) {
      if (entry.type !== "custom" || !record(entry.data)) continue
      const at = closeInstantOf(entry.customType, entry.data)
      if (at === undefined) continue
      if (Number.isFinite(at) && (closedAt === undefined || at > closedAt)) closedAt = at
    }
    return closedAt
  } finally {
    closeSync(fd)
  }
}

/**
 * A session the engine spawned for a task carries its ancestry in `spawnedBy`; a header that names the host's session kind
 * `worker` is one too. Neither is woken: its parent is not live, so it would ask for every gated call and park (5.2 step 2).
 * The classifier is closed: only a header it can read, with no `kind` at all, is `interactive`. A header it cannot read
 * and a `kind` it does not know are `unknown`, which no caller wakes or reopens.
 */
function sessionKindOf(header: Record<string, unknown> | null): WakeSessionKind {
  if (header === null) return "unknown"
  if (header.kind === "worker") return "worker"
  if (record(header.spawnedBy)) return "child"
  if (header.kind === undefined) return "interactive"
  return "unknown"
}

export function resolveWakeTarget(sessionsDirectory: string, durableId: string): WakeTarget {
  const found = findDiskSessions(sessionsDirectory, durableId, { id_only: true })
  const [only] = found
  if (only === undefined) return { kind: "gone" }
  if (found.length > 1) return { kind: "ambiguous", session_paths: found.map((session) => session.session_path) }
  const closedAt = closedAtOf(only.session_path)
  return {
    kind: "found",
    session_path: only.session_path,
    cwd: only.cwd,
    session_kind: sessionKindOf(headerOf(only.session_path)),
    ...(closedAt === undefined ? {} : { closed_at: closedAt }),
  }
}
