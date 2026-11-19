import { deviceLabel, formatAddress, type AddressRefusal } from "@oh-my-opencode/thread-address-core"
import type { ThreadAddressError, ThreadCandidate } from "../addressing"
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "../errors"

/** A refusal as the thread tools answer it: a taxonomy code, the message, the recovery step and the details. */
export type ThreadRefusal = ThreadAddressError & { readonly details?: Readonly<Record<string, unknown>> }

/**
 * The core's candidate shape on top of the ladder's: `address` (`<device id>/<thread>`) resolves as written and
 * `device_name` names the device. With no device id known the candidate carries no `address`: its `thread` is the
 * address then, and one field names a session (#14044).
 */
export type AddressCandidate = ThreadCandidate & { readonly address?: string; readonly device_name?: string }

export const refusal = (
  code: ThreadErrorCode,
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): ThreadRefusal => ({ kind: "error", ...threadToolFailure(code, message, next, details) })

export const asRefusal = (failure: ThreadToolFailure): ThreadRefusal => ({ kind: "error", ...failure })

/** A refusal as the failure a tool result carries (`{ kind: "error", error }`). */
export function asFailure(refused: ThreadRefusal): ThreadToolFailure {
  const { kind: _kind, candidates: _candidates, ...failure } = refused
  return failure
}

const LIST_ALL = "call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell)"
const RETRY_LIST =
  "Retry the call; call thread_list (tool.thread_list() in an eval cell) to see which devices answered."

const labels = (ids: readonly string[], names: readonly string[]): string =>
  ids.map((id, index) => deviceLabel({ id, name: names[index] ?? "" })).join(", ")

/** The core's plain refusal, worded for the thread tools; `thread` is the address part that missed, when one did. */
export function toolRefusal(core: AddressRefusal, thread?: string): ThreadRefusal {
  const details = core.details
  switch (core.reason) {
    case "no_device":
      return refusal(
        "not_found",
        `No device named ${core.typed} is signed in to this account.`,
        `Pass a device name or id from candidates, or ${LIST_ALL}.`,
        details,
      )
    case "devices_share_name":
      return refusal(
        "ambiguous_target",
        `${core.details.candidates.length} ${core.details.candidates.every((row) => row.online) ? "online " : ""}devices are named ${core.typed}; none was picked.`,
        "Pass the device id from candidates.",
        details,
      )
    case "devices_share_prefix":
      return refusal(
        "ambiguous_target",
        `${core.details.candidates.length} devices have an id starting ${core.typed}; none was picked.`,
        "Pass more of the device id, or its name.",
        details,
      )
    case "device_offline":
      return refusal(
        "device_offline",
        `Device ${core.typed} is offline.`,
        "Retry when that device is online; nothing was queued.",
        details,
      )
    case "listing_incomplete":
      return refusal(
        "host_unavailable",
        `Nothing matched on the devices that answered; ${labels(core.details.devices, core.details.device_names)} did not answer this listing round.`,
        RETRY_LIST,
        details,
      )
    case "device_unanswered":
      return refusal(
        "host_unavailable",
        `No device that answered holds ${thread === undefined ? "it" : `session ${thread}`}, and ${labels(core.details.devices, core.details.device_names)} did not answer.`,
        "Retry when that device answers.",
        { ...details, ...(thread === undefined ? {} : { thread }) },
      )
    case "probe_unavailable":
      return refusal(
        "host_unavailable",
        `${deviceLabel({ id: core.details.device, name: core.details.device_name })} does not list ${core.details.thread}, and this device's service cannot ask it.`,
        "Retry when that device lists the thread.",
        details,
      )
    case "no_thread_on_device":
      return refusal(
        "not_found",
        `No thread ${core.details.thread} on ${deviceLabel({ id: core.details.device, name: core.details.device_name })}.`,
        `Pass a thread that device holds, or ${LIST_ALL}.`,
        details,
      )
  }
}

/**
 * The ladder's refusal with the core's candidate shape and `details.kind` (design section 5). A candidate's device is the
 * id: this device's own candidates name it once the account told this device its id (`here`), and otherwise keep `here`.
 */
export function withAddresses(
  error: ThreadAddressError,
  here: string | null,
  nameOf: (device: string) => string | undefined,
): ThreadRefusal {
  const thread: Readonly<Record<string, unknown>> = { kind: "thread" }
  if (error.candidates === undefined)
    return error.code === "not_found" || error.code === "ambiguous_target" ? { ...error, details: thread } : error
  const candidates = error.candidates.map((candidate): AddressCandidate => {
    const device = candidate.device === "here" ? (here ?? "here") : candidate.device
    const name = device === undefined ? undefined : nameOf(device)
    return {
      ...candidate,
      ...(device === undefined ? {} : { device }),
      ...(device === undefined ? {} : { address: formatAddress(device, candidate.thread) }),
      ...(name === undefined ? {} : { device_name: name }),
    }
  })
  return { ...error, candidates, details: { ...thread, candidates } }
}
