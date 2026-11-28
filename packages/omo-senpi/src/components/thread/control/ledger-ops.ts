import { isAbsolute } from "node:path"

import type { ThreadToolResult } from "../contracts"
import { applyLedgerChange, THREAD_LEDGER_RPC, type LedgerAnswer, type LedgerChange } from "../ledger-change"
import { farExtensionRequest } from "../remote/far-request"
import { thisDeviceId } from "../remote/this-device"
import { resolveCallerDurableId } from "../tools/extension-tools"
import { failure } from "../tools/internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "../tools/ports"
import { locateControl, type LocatedControl } from "./locate"

type Where = { readonly thread: string; readonly device?: string; readonly cwd?: string }
type NotRecorded = { readonly device: string; readonly code: string; readonly message: string }

function whereOf(found: Exclude<LocatedControl, { readonly kind: "error" }>): Where {
  const row = found.row
  const thread = found.kind === "control" ? found.control.thread_id : found.thread_id
  const device = found.kind === "control" ? found.control.device : (found.device ?? row?.device)
  return {
    thread,
    ...(device === undefined ? {} : { device }),
    ...(row?.path === undefined ? {} : { cwd: row.path }),
  }
}

function refusal(answer: Exclude<LedgerAnswer, { readonly kind: "ok" }>, thread: string): ThreadToolResult {
  const next =
    answer.code === "metadata_too_large"
      ? "Store a value of at most 4096 bytes as JSON; keep the rest in a file the thread can read."
      : answer.code === "not_creator"
        ? "Only the thread's current opener (its created_by) can hand it over."
        : "Fix the request and retry."
  const code = answer.code === "metadata_too_large" || answer.code === "not_creator" ? answer.code : "invalid_arguments"
  return failure(code, answer.message, next, {
    thread,
    ...(answer.bytes === undefined ? {} : { bytes: answer.bytes, limit: answer.limit }),
  })
}

/**
 * Applies `change` here, then sends it to every other device in `places` (`omo.thread.ledger`, `ledger-change.ts`).
 * A device it could not reach, or that refused, is named in `not_recorded`, never dropped.
 */
async function spread(
  options: ThreadToolSurfaceOptions,
  change: LedgerChange,
  places: readonly { readonly device?: string; readonly cwd?: string }[],
): Promise<{ readonly recorded_on: readonly string[]; readonly not_recorded: readonly NotRecorded[] }> {
  const here = await thisDeviceId(options.remote)
  const hereId = "device" in here ? here.device : undefined
  const far = new Map<string, string | undefined>()
  for (const place of places) {
    if (place.device === undefined || place.device === hereId) continue
    const known = far.get(place.device)
    if (known === undefined) far.set(place.device, place.cwd !== undefined && isAbsolute(place.cwd) ? place.cwd : undefined)
  }
  const recorded_on: string[] = [hereId ?? "here"]
  const not_recorded: NotRecorded[] = []
  for (const [device, cwd] of far) {
    if (options.remote === undefined || cwd === undefined) {
      not_recorded.push({
        device,
        code: "folder_unknown",
        message: `No folder on device ${device} is known to open the request in.`,
      })
      continue
    }
    const answer = await farExtensionRequest(options.remote, device, cwd, THREAD_LEDGER_RPC, change, {
      message: `omo on device ${device} cannot record hand-overs or metadata yet.`,
      next: "Update omo on that device, then retry; the change is already recorded here.",
    })
    if (answer.kind === "answered" && answer.data["kind"] === "ok") recorded_on.push(device)
    else
      not_recorded.push({
        device,
        code: answer.kind === "error" ? answer.error.code : String(answer.data["code"] ?? "unexpected_reply"),
        message: answer.kind === "error" ? answer.error.message : String(answer.data["message"] ?? ""),
      })
  }
  return { recorded_on, not_recorded }
}

/**
 * Hands `thread` to `to` (#15221 row 25): recorded on the old opener's device, the new opener's and the child's. A
 * caller with a session must be the current opener; the CLI acts for the account.
 */
export async function handOverThreadOp(
  options: ThreadToolSurfaceOptions,
  view: ThreadHostView,
  request: { readonly thread: string; readonly to: string; readonly all_scope?: boolean },
  callerId: string,
): Promise<ThreadToolResult> {
  const child = await locateControl(options, view, request.thread, request.all_scope, callerId)
  if (child.kind === "error") return child.result
  const heir = await locateControl(options, view, request.to, true, callerId)
  if (heir.kind === "error") return heir.result
  const [created, to] = [whereOf(child), whereOf(heir)]
  if (created.thread === to.thread)
    return failure("invalid_arguments", "A thread cannot be handed to itself.", "Name another thread as to.", {
      thread: created.thread,
    })
  const opener = await options.store.threadOpener(created.thread)
  if (opener === undefined)
    return failure(
      "not_found",
      `This device has no record of who opened ${created.thread}.`,
      "Run the hand-over on the device of its opener or of the thread itself (tool.thread_list() in an eval cell shows created_by).",
      { thread: created.thread },
    )
  const caller = resolveCallerDurableId(options, view, callerId)
  if (caller !== undefined && caller !== opener.creator_durable_id)
    return refusal({ kind: "refused", code: "not_creator", message: `${caller} did not open ${created.thread}.` }, created.thread)
  const here = await thisDeviceId(options.remote)
  const toDevice = to.device ?? ("device" in here ? here.device : undefined)
  const change: LedgerChange = {
    op: "hand_over",
    created: created.thread,
    from: opener.creator_durable_id,
    to: to.thread,
    ...(toDevice === undefined ? {} : { to_device: toDevice }),
  }
  const local = await applyLedgerChange(options.store, change)
  if (local.kind !== "ok") return refusal(local, created.thread)
  const previous: { device?: string; cwd?: string } = opener.creator_device === null ? {} : { device: opener.creator_device }
  if (previous.device !== undefined && previous.device !== created.device && previous.device !== to.device) {
    const found = await locateControl(options, view, opener.creator_durable_id, true, callerId)
    if (found.kind !== "error") previous.cwd = whereOf(found).cwd
  }
  const spreadTo = await spread(options, change, [created, to, previous])
  return {
    kind: "ok",
    thread: created.thread,
    created_by: { thread: to.thread, ...(toDevice === undefined ? {} : { device: toDevice }) },
    handed_over_from: opener.creator_durable_id,
    ...spreadTo,
  }
}

/** Sets `thread`'s one metadata value, at most 4 KB as JSON, here and on the device that holds the thread. */
export async function setThreadMetadataOp(
  options: ThreadToolSurfaceOptions,
  view: ThreadHostView,
  request: { readonly thread: string; readonly value: unknown; readonly all_scope?: boolean },
  callerId: string,
): Promise<ThreadToolResult> {
  const found = await locateControl(options, view, request.thread, request.all_scope, callerId)
  if (found.kind === "error") return found.result
  const target = whereOf(found)
  const caller = resolveCallerDurableId(options, view, callerId)
  const change: LedgerChange = {
    op: "set_metadata",
    thread: target.thread,
    value: request.value,
    ...(caller === undefined ? {} : { updated_by: caller }),
  }
  const local = await applyLedgerChange(options.store, change)
  if (local.kind !== "ok") return refusal(local, target.thread)
  return { kind: "ok", thread: target.thread, ...(await spread(options, change, [target])) }
}
