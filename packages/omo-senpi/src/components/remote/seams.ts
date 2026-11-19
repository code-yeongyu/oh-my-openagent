import { formatAddress, parseAddress } from "../../../../thread-address-core/src/parse"
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
  const parsed = parseAddress(text)
  if (parsed.kind === "device")
    return {
      kind: "ok",
      value: {
        handle: handleOf(parsed.device, parsed.thread),
        target: { kind: "device_session", device: parsed.device, session: parsed.thread },
        scope,
      },
    }
  return { kind: "ok", value: { handle: text as ThreadHandle, target: { kind: "address", address: text }, scope } }
}

/** The handle of a session a device listed: `<device>/<session>`, the monitor target form. */
export const handleOf = (device: string, session: string): ThreadHandle => formatAddress(device, session) as ThreadHandle

/** Seam 2: the only helper that names a thread to a person; every message and renderer goes through it. */
export function describeThread(row: SessionRow): string {
  const label = row.name !== "" ? row.name : row.title !== "" ? row.title : "untitled thread"
  return `"${label}" on ${row.device.name} (${row.thread})`
}
