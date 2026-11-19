import type { ThreadToolResult } from "../contracts"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import { toThreadAddressEntries } from "../address-book"
import { workspaceEntries } from "../addressing"
import { resolveAddress } from "../address/lazy"
import { rowThreadId } from "../remote/ports"
import { createRelayControl } from "../remote/lazy-ops"
import { sendAddressBook, targetSession } from "../tools/internals"
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
 * account (`resolveAddress`, which takes `<device>/<thread>` too) becomes the control of the thread it names, over this
 * device's endpoint or over the other device's relay. A device found offline refuses there (A3: nothing is queued),
 * before any check that would change something.
 */
export async function locateControl(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  address: string,
  allScope: boolean | undefined,
  callerId: string,
): Promise<LocatedControl> {
  // Decision 0027: the entries are the ones a send resolves against, session files no engine runs included, so every
  // tool finds the thread a send finds. A thread id no device lists gets the per-device probe (A4.3.3, #13215): a
  // session another device holds but runs nowhere is its ended row, so it answers not_live there as here.
  const entries = toThreadAddressEntries(sendAddressBook(options, current, address.replace(/^here\//, ""), true))
  const resolved = await resolveAddress(
    { remote: options.remote, callerWorkspaceRoot: options.callerWorkspaceRoot(), local: entries, callerId },
    address,
    { all_scope: allScope, probe: true, need: "online" },
  )
  if (resolved.kind === "error") return { kind: "error", result: { kind: "error", error: resolved } }
  if (resolved.where.kind === "device" && options.remote !== undefined) {
    const row = resolved.where.row
    if (row.state === "ended")
      return { kind: "not_live", thread_id: rowThreadId(row), title: escapeForDisplay(row.title), device: row.device }
    return { kind: "control", control: createRelayControl(options.remote, row) }
  }
  const session = targetSession(current, resolved.thread)
  if (session === undefined) return { kind: "not_live", thread_id: resolved.thread, title: resolved.entry.name }
  return {
    kind: "control",
    control: createLocalControl(options, session, resolved.thread, resolved.entry.name, () =>
      allScope === true ? entries : workspaceEntries(entries, options.callerWorkspaceRoot()),
    ),
  }
}
