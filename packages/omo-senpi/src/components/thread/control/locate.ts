import type { ThreadToolResult } from "../contracts"
import { createRelayControl, crossTarget, deviceOnline } from "../remote/lazy-ops"
import { localScope } from "../remote/local-scope"
import { resolution, resolveEntries, targetSession } from "../tools/internals"
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
 * account's session list (`crossTarget`) becomes the control of the thread it names, over this device's endpoint or
 * over the other device's relay. A device found offline refuses here (A3: nothing is queued), before any check that
 * would change something.
 */
export async function locateControl(options: ThreadToolSurfaceOptions, current: ThreadHostView, address: string, allScope: boolean | undefined, callerId: string): Promise<LocatedControl> {
  const entries = resolveEntries(options, current)
  const target = options.remote === undefined ? { kind: "local" as const, address } : await crossTarget(options.remote, address, resolution(options, entries, address, callerId, true))
  if (target.kind === "error") return target
  if (target.kind === "remote" && options.remote !== undefined) {
    const offline = await deviceOnline(options.remote, target.row.device)
    if (offline !== undefined) return { kind: "error", result: offline }
    if (target.row.state === "ended") return { kind: "not_live", thread_id: target.row.session_id, title: target.row.title, device: target.row.device }
    return { kind: "control", control: createRelayControl(options.remote, target.row) }
  }
  const resolved = resolution(options, entries, target.kind === "local" ? target.address : address, callerId, localScope(target, allScope))
  if (resolved.kind === "error") return { kind: "error", result: { kind: "error", error: resolved } }
  const session = targetSession(current, resolved.entry.thread_id)
  if (session === undefined) return { kind: "not_live", thread_id: resolved.entry.thread_id, title: resolved.entry.name }
  return { kind: "control", control: createLocalControl(options, session, resolved.entry.thread_id, resolved.entry.name) }
}
