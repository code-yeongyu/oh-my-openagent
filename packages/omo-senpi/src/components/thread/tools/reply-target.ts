// Ships in the thread client sidecar (`#omo-thread-client-runtime`) and loads through `../remote/lazy-ops` only for a
// send approved as a reply, so `omo.js` carries none of the reply routing.
import type { ThreadAddressEntry } from "../addressing"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { ThreadToolSurfaceOptions } from "./ports"
import { consumedSendersOf } from "./reply-permission"

export const otherDevice = (device: string | undefined, here: string | undefined): string | undefined =>
  device === here ? undefined : device

export function replyTargetMismatch(
  options: ThreadToolSurfaceOptions,
  address: string,
  entry: ThreadAddressEntry,
  here: string | undefined,
): ThreadToolFailure | undefined {
  const senders = consumedSendersOf(options, address)
  if (senders.length === 0) return undefined
  const entryDevice = otherDevice(entry.device, here)
  if (
    senders.some((sender) => sender.session_id === entry.thread_id && otherDevice(sender.device, here) === entryDevice)
  )
    return undefined
  return threadToolFailure(
    "reply_target_mismatch",
    `"${address}" was approved as a reply to a sender of this run's deliveries, but it resolves to ${entry.name} (${entry.thread_id}${entry.device === undefined ? "" : " on " + entry.device}), which is not that sender.`,
    "Reply with the sender's durable id from the delivery header, or send to the other thread by its id as a normal send.",
    { resolved_thread_id: entry.thread_id, ...(entry.device === undefined ? {} : { device: entry.device }) },
  )
}

type ConsumedSender = { readonly session_id: string; readonly device?: string }

/**
 * This device's own id, read only when a consumed sender names a device: a sender naming it is a sender on this device.
 * A failed read is a typed host_unavailable, never undefined: without the id a sender on this device cannot be told from
 * one on another device, and guessing "another device" would route a local reply through the relay (#13218 review).
 */
export async function thisDeviceOf(
  options: ThreadToolSurfaceOptions,
  senders: readonly ConsumedSender[],
): Promise<string | undefined | ThreadToolFailure> {
  if (options.remote === undefined || !senders.some((sender) => sender.device !== undefined)) return undefined
  try {
    return (await options.remote.sessions.thisDevice()) ?? undefined
  } catch (error) {
    const devices = [...new Set(senders.flatMap((sender) => (sender.device === undefined ? [] : [sender.device])))]
    return threadToolFailure(
      "host_unavailable",
      "This device's id could not be read, so a reply to a sender named by its device cannot be routed; nothing was sent.",
      "Retry when the device service is reachable.",
      { devices, reason: error instanceof Error ? error.message : String(error) },
    )
  }
}

/** True when `address` is an approved reply to a consumed sender on another device, or names such senders ambiguously. */
export async function replyLeavesThisDevice(options: ThreadToolSurfaceOptions, address: string): Promise<boolean> {
  const senders = consumedSendersOf(options, address)
  if (!senders.some((sender) => sender.device !== undefined)) return false
  const here = await thisDeviceOf(options, senders)
  // An unreadable device id takes no local listing either: the send answers that failure (sendTarget) before any route.
  if (typeof here === "object") return true
  const replyTo = replySender(address, senders, here)
  return replyTo !== undefined && ("code" in replyTo || replyTo.device !== undefined)
}

/**
 * The one consumed sender a reply addresses, its device absent for this device; undefined when the send is no reply. One
 * session id stated from two devices, or one name stated by two senders, is ambiguous_target: none is picked.
 */
export function replySender(
  address: string,
  senders: readonly ConsumedSender[],
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
        id: sender.session_id,
        ...(sender.device === undefined ? {} : { device: sender.device }),
      })),
    },
  )
}
