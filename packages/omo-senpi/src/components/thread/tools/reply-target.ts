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
