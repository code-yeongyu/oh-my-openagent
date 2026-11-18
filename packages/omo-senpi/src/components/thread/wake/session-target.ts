import { closeSync, openSync, readSync } from "node:fs"

import { findDiskSessions } from "../address-book"
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
  return {
    kind: "found",
    session_path: only.session_path,
    cwd: only.cwd,
    session_kind: sessionKindOf(headerOf(only.session_path)),
  }
}
