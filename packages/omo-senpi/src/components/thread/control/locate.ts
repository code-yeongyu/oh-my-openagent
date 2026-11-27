import type { ThreadToolResult } from "../contracts"
import { workspaceEntries } from "../addressing"
import { principalOf } from "../address/principal"
import { resolve } from "../address/lazy"
import { createRelayControl } from "../remote/lazy-ops"
import { failure, sendBookFor, targetSession } from "../tools/internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "../tools/ports"
import { createLocalControl } from "./local-control"
import { notLiveRow, type NotLive } from "./not-live"
import type { SessionControl } from "./port"

export type LocatedControl =
  | { readonly kind: "control"; readonly control: SessionControl }
  | NotLive
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
  const localFor = sendBookFor(options, current)
  const entries = localFor(address)
  const resolved = await resolve(
    { remote: options.remote, workspace: options.callerWorkspaceRoot(), book: localFor },
    address,
    {
      operation: "control",
      principal: principalOf(callerId),
      scope: { all_scope: allScope },
      probe: true,
      need: "online",
    },
  )
  if (resolved.kind === "error") return { kind: "error", result: { kind: "error", error: resolved } }
  if (resolved.holder.kind === "device" && options.remote !== undefined) {
    const row = resolved.holder.row
    return notLiveRow(row) ?? { kind: "control", control: createRelayControl(options.remote, row) }
  }
  const session = targetSession(current, resolved.id)
  if (session === undefined) return { kind: "not_live", thread_id: resolved.id, title: resolved.entry.name }
  if (session.status === "opening")
    return {
      kind: "error",
      result: failure(
        "host_unavailable",
        `Thread ${resolved.id} is opening on its host and cannot accept controls yet.`,
        "Retry once the thread is open.",
        { thread: resolved.id, reason: "session_opening" },
      ),
    }
  return {
    kind: "control",
    control: createLocalControl(options, session, resolved.id, resolved.entry.name, () =>
      allScope === true ? entries : workspaceEntries(entries, options.callerWorkspaceRoot()),
    ),
  }
}
