import { deviceLabel, formatAddress, type AddressRefusal } from "@oh-my-opencode/thread-address-core"
import type { ThreadAddressError, ThreadCandidate } from "../addressing"
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "../errors"
import { carryProvenance, refusal as textRefusal } from "../refusal-texts"

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

/** A failure as a tool result carries it (`{ kind: "error", error }`): remote-ops.ts and holder.ts answer this shape. */
export type Failed = { readonly kind: "error"; readonly error: ThreadToolFailure }

export const failed = (
  code: ThreadErrorCode,
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failed => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

export const asRefusal = (failure: ThreadToolFailure): ThreadRefusal =>
  carryProvenance(failure, { kind: "error", ...failure })

/** A refusal as the failure a tool result carries (`{ kind: "error", error }`). */
export function asFailure(refused: ThreadRefusal): ThreadToolFailure {
  const { kind: _kind, candidates: _candidates, ...failure } = refused
  // The template the refusal came from travels with it, so a receipt records it by reference (#15021).
  return carryProvenance(refused, failure)
}

const labels = (ids: readonly string[], names: readonly string[]): string =>
  ids.map((id, index) => deviceLabel({ id, name: names[index] ?? "" })).join(", ")

/** A failure refusal() produced, as the thread tools answer it. */
const asThreadRefusal = (failure: ThreadToolFailure): ThreadRefusal =>
  carryProvenance(failure, { kind: "error", ...failure })

/** The core's plain refusal, worded for the thread tools; `thread` is the address part that missed, when one did. */
export function toolRefusal(core: AddressRefusal, thread?: string, answered?: readonly string[]): ThreadRefusal {
  const details = core.details
  switch (core.reason) {
    case "no_device":
      return asThreadRefusal(textRefusal("address.no_device", { typed: core.typed }, details))
    case "devices_share_name":
      return asThreadRefusal(
        textRefusal(
          "address.devices_share_name",
          {
            count: String(core.details.candidates.length),
            online: core.details.candidates.every((row) => row.online) ? "online " : "",
            typed: core.typed,
          },
          details,
        ),
      )
    case "devices_share_prefix":
      return asThreadRefusal(
        textRefusal(
          "address.devices_share_prefix",
          { count: String(core.details.candidates.length), typed: core.typed },
          details,
        ),
      )
    case "device_offline":
      return asThreadRefusal(textRefusal("address.device_offline", { typed: core.typed }, details))
    case "listing_incomplete":
      return asThreadRefusal(
        textRefusal(
          "address.listing_incomplete",
          { devices: labels(core.details.devices, core.details.device_names) },
          details,
        ),
      )
    case "device_unanswered": {
      const slow: string[] = []
      const unanswered: string[] = []
      core.details.devices.forEach((id, index) => {
        const label = deviceLabel({ id, name: core.details.device_names[index] ?? "" })
        if (core.details.device_reasons?.[id] === "lookup_timeout") slow.push(label)
        else unanswered.push(label)
      })
      const outcomes = [
        ...(slow.length === 0
          ? []
          : [`${slow.join(", ")} ${slow.length === 1 ? "was" : "were"} too slow for the lookup`]),
        ...(unanswered.length === 0 ? [] : [`${unanswered.join(", ")} did not answer`]),
      ]
      const retry =
        slow.length === 0
          ? `Retry when ${unanswered.length === 1 ? "that device answers" : "those devices answer"}.`
          : "Retry the lookup; a slow device may answer in time on another attempt."
      // omo#14270: a miss on the device that really keeps the file reads as "wait for the silent one" without this.
      const next =
        answered === undefined || answered.length === 0
          ? retry
          : `${retry} If the session should be on a device that answered, its file is not where that device looks for sessions.`
      return asThreadRefusal(
        textRefusal(
          "address.device_unanswered",
          {
            answered: answered === undefined || answered.length === 0 ? "" : ` (${answered.join(", ")})`,
            target: thread === undefined ? "it" : `session ${thread}`,
            outcomes: outcomes.join(", and "),
            retry: next,
          },
          { ...details, ...(thread === undefined ? {} : { thread }), ...(answered === undefined ? {} : { answered }) },
        ),
      )
    }
    case "remote_unavailable":
      return asThreadRefusal(
        textRefusal(
          "address.remote_unavailable",
          {
            device: deviceLabel({ id: core.details.device, name: core.details.device_name }),
            thread: core.details.thread,
          },
          details,
        ),
      )
    case "wake_unavailable":
    case "lookup_unavailable":
      return asThreadRefusal(
        textRefusal(
          core.reason === "wake_unavailable" ? "address.wake_unavailable" : "address.lookup_unavailable",
          {
            device: deviceLabel({ id: core.details.device, name: core.details.device_name }),
            thread: core.details.thread,
          },
          details,
        ),
      )
    case "no_thread_on_device":
      return asThreadRefusal(
        textRefusal(
          "address.no_thread_on_device",
          {
            device: deviceLabel({ id: core.details.device, name: core.details.device_name }),
            thread: core.details.thread,
          },
          details,
        ),
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
      // A row with no thread id is passed back by its row key, `<device id>/<listing key>`: already an address.
      ...(device === undefined
        ? {}
        : {
            address: candidate.thread.startsWith(`${device}/`)
              ? candidate.thread
              : formatAddress(device, candidate.thread),
          }),
      ...(name === undefined ? {} : { device_name: name }),
    }
  })
  return { ...error, candidates, details: { ...thread, candidates } }
}
