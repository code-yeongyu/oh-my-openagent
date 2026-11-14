import { nextActionFor, remoteFailure } from "./codes"
import type { RemoteFailure, Scope, SessionRow, ThreadHandle } from "./types"

/** What a thread address names before any lookup: a session on a named device, or an address on this device's view. */
export type CanonicalThread = {
  readonly handle: ThreadHandle
  readonly target:
    | { readonly kind: "device_session"; readonly device: string; readonly session: string }
    | { readonly kind: "address"; readonly address: string }
  readonly scope: Scope
}

// senpi's remote monitor target shape (omo-senpi extension/senpi-seams.ts, from senpi rpc-monitor-targets.ts
// `parseRpcTarget`): one `/`, no leading `/`, not a `.jsonl` path, not a drive letter, and a first segment no path-only
// prefix (`.`, `..`, `.hidden`, `~`) can start, so a local path is never read as a device.
const DEVICE_SESSION = /^([^/]+)\/([^/]+)$/
const DRIVE_LETTER = /^[A-Za-z]:$/
const PATH_SEGMENT = /^[.~]/

/**
 * Seam 1 (design v8-core r2, B1): the ONLY parser of a thread address. It names no leg: the resolver that finds where
 * the thread lives takes this result and the scope. `<device>/<session>` (the monitor target form) names a session on a
 * device; any other non-empty text is an address (an id, a name or an alias) resolved later.
 */
export function canonicalizeThreadHandle(
  input: string,
  scope: Scope,
): { readonly kind: "ok"; readonly value: CanonicalThread } | RemoteFailure {
  const text = input.trim()
  if (text === "")
    return remoteFailure("invalid_arguments", "A thread address is empty.", nextActionFor("invalid_arguments"))
  const match = DEVICE_SESSION.exec(text)
  const device = match?.[1]
  const session = match?.[2]
  if (
    device !== undefined &&
    session !== undefined &&
    !/\.jsonl$/i.test(text) &&
    !DRIVE_LETTER.test(device) &&
    !PATH_SEGMENT.test(device)
  )
    return {
      kind: "ok",
      value: { handle: `${device}/${session}`, target: { kind: "device_session", device, session }, scope },
    }
  return { kind: "ok", value: { handle: text, target: { kind: "address", address: text }, scope } }
}

/** Seam 2: the only helper that names a thread to a person; every message and renderer goes through it. */
export function describeThread(row: SessionRow): string {
  const label = row.name !== "" ? row.name : row.title !== "" ? row.title : "untitled thread"
  return `"${label}" on ${row.device.name} (${row.thread})`
}
