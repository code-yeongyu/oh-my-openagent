import type { ThreadToolResult } from "../contracts"
import { workspaceEntries } from "../addressing"
import { rowThreadId } from "../remote/ports"
import { createRelayControl, deviceOnline } from "../remote/lazy-ops"
import { resolution, resolveEntries, targetSession, resolveAcross } from "../tools/internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "../tools/ports"
import { createLocalControl } from "./local-control"
import type { SessionControl } from "./port"

export type LocatedControl =
  | { readonly kind: "control"; readonly control: SessionControl }
  /** The address names a thread no engine holds live: its session file here, or an ended session on another device. */
  | { readonly kind: "not_live"; readonly thread_id: string; readonly title: string; readonly device?: string }
  | { readonly kind: "error"; readonly result: ThreadToolResult }

/**
 * The only place a control tool reads the device: an address resolved through this device's address book and the
 * account's session list (the one resolver, `resolveAcross`) becomes the control of the thread it names, over this device's endpoint or
 * over the other device's relay. A device found offline refuses here (A3: nothing is queued), before any check that
 * would change something.
 */
export async function locateControl(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  address: string,
  allScope: boolean | undefined,
  callerId: string,
): Promise<LocatedControl> {
  // Decision 0027: one resolver over this device's entries and the relay transport's address book.
  const entries = resolveEntries(options, current)
  const resolved = await resolveAcross(options, entries, address, callerId, allScope)
  if (resolved.kind === "ok" && resolved.entry.transport?.kind === "relay" && options.remote !== undefined) {
    const row = resolved.entry.transport.row
    const offline = await deviceOnline(options.remote, row.device)
    if (offline !== undefined) return { kind: "error", result: offline }
    if (row.state === "ended")
      return { kind: "not_live", thread_id: rowThreadId(row), title: row.title, device: row.device }
    return { kind: "control", control: createRelayControl(options.remote, row) }
  }
  if (resolved.kind === "error") return { kind: "error", result: { kind: "error", error: resolved } }
  const session = targetSession(current, resolved.entry.thread_id)
  if (session === undefined)
    return { kind: "not_live", thread_id: resolved.entry.thread_id, title: resolved.entry.name }
  return {
    kind: "control",
    control: createLocalControl(options, session, resolved.entry.thread_id, resolved.entry.name, () =>
      allScope === true ? entries : workspaceEntries(entries, options.callerWorkspaceRoot()),
    ),
  }
}
