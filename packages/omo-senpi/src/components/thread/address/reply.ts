import { withinCallBudget } from "../../call-budget/call-deadline"
import type { ThreadAddressEntry } from "../addressing"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { RemoteThreadSurface } from "../remote/ports"
import { accountDevices } from "./account"

// The reply policy's pieces (design section 5) that the send operation in omo.js also reads before it resolves (the view
// a reply takes); their own module, so the entry bundle carries them without the resolver.

/** A sender of a delivery the caller consumed, as the engine's reply allowance approved it; no device = this device. */
export type ReplySender = { readonly session_id: string; readonly name?: string; readonly device?: string }

const otherDevice = (device: string | undefined, here: string | undefined): string | undefined =>
  device === here ? undefined : device

/** The refusal of a reply whose address resolved to a session that is not the consumed sender. */
export function replyTargetFailure(address: string, entry: ThreadAddressEntry): ThreadToolFailure {
  return threadToolFailure(
    "reply_target_mismatch",
    `"${address}" was approved as a reply to a sender of this run's deliveries, but it resolves to ${entry.name} (${entry.thread_id}${entry.device === undefined ? "" : " on " + entry.device}), which is not that sender.`,
    "Reply with the sender's durable id from the delivery header, or send to the other thread by its id as a normal send.",
    { thread: entry.thread_id, ...(entry.device === undefined ? {} : { device: entry.device }) },
  )
}

/** A reply lands only on one of the senders it was approved for, on that sender's device; undefined when it does. */
export function replyTargetMismatch(
  senders: readonly ReplySender[],
  address: string,
  entry: ThreadAddressEntry,
  here: string | undefined,
): ThreadToolFailure | undefined {
  if (senders.length === 0) return undefined
  const entryDevice = otherDevice(entry.device, here)
  if (
    senders.some((sender) => sender.session_id === entry.thread_id && otherDevice(sender.device, here) === entryDevice)
  )
    return undefined
  return replyTargetFailure(address, entry)
}

/**
 * This device's own id, read only when a consumed sender names a device: a sender naming it is a sender on this device.
 * A failed read is a typed host_unavailable, never undefined: without the id a sender on this device cannot be told from
 * one on another device, and guessing "another device" would route a local reply through the relay (#13218 review).
 */
export async function thisDeviceOf(
  remote: RemoteThreadSurface | undefined,
  senders: readonly ReplySender[],
): Promise<string | undefined | ThreadToolFailure> {
  if (remote === undefined || !senders.some((sender) => sender.device !== undefined)) return undefined
  const unavailable = (reason: string) =>
    threadToolFailure(
      "host_unavailable",
      "This device's id could not be read, so a reply to a sender named by its device cannot be routed; nothing was sent.",
      "Retry when the device service is reachable.",
      {
        devices: [...new Set(senders.flatMap((sender) => (sender.device === undefined ? [] : [sender.device])))],
        reason,
      },
    )
  try {
    // #14226: the read is cut by what is left of the call's budget, not only by the device client's own deadline.
    const listed = await withinCallBudget(accountDevices(remote.client))
    if (listed === undefined) return unavailable("request_timeout")
    return listed.here ?? undefined
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error))
  }
}

/**
 * The one consumed sender a reply addresses, its device absent for this device; undefined when the call is no reply. One
 * session id stated from two devices, or one name stated by two senders, is ambiguous_target: none is picked.
 */
export function replySender(
  address: string,
  senders: readonly ReplySender[],
  here: string | undefined,
): { readonly session_id: string; readonly device: string | undefined } | ThreadToolFailure | undefined {
  const distinct = new Map<string, { readonly session_id: string; readonly device: string | undefined }>()
  for (const sender of senders) {
    const device = otherDevice(sender.device, here)
    distinct.set(JSON.stringify([sender.session_id, device ?? null]), { session_id: sender.session_id, device })
  }
  const found = [...distinct.values()]
  if (found.length <= 1) return found[0]
  return threadToolFailure(
    "ambiguous_target",
    `"${address}" names more than one sender of this run's deliveries; none was picked.`,
    "Send to the intended thread as a normal send, by its id.",
    {
      candidates: found.map((sender) => ({
        thread: sender.session_id,
        ...(sender.device === undefined ? {} : { device: sender.device }),
      })),
    },
  )
}
