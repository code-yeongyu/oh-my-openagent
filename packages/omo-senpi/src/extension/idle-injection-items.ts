import type { RunRef } from "../../../senpi-task/src/pause/ports"
import type { IdleInjection, IdleInjectionMessage } from "./idle-injection-coordinator"
import { runReceipts, type ReceiptErrors } from "./idle-injection-receipts"

export type AdmissionItem = {
  readonly itemId: string
  readonly producer: string
  readonly content: string
  // This item's text inside the batch message, so the engine can hold or deliver it on its own.
  readonly contentRange: readonly [number, number]
  readonly runRef?: RunRef
  readonly customType?: string
  readonly details?: unknown
  readonly display?: boolean
  readonly contextScoped?: boolean
}

export type ItemReceipt = {
  readonly itemId: string
  readonly disposition: "notice_persisted" | "message_persisted"
  readonly entryId: string
  readonly noticeId?: string
}

// One entry per key: a later enqueue under the same key replaces the content, and the enqueues it
// replaced are settled with whatever receipt the surviving item gets.
export type QueuedInjection = IdleInjection & {
  readonly itemId: string
  readonly superseded: readonly IdleInjection[]
}

export function withSuperseded(injection: QueuedInjection): readonly IdleInjection[] {
  return [injection, ...injection.superseded]
}

// One flush is ONE delivery (one model turn at most): every item rides it with its own identity, run
// reference and text range, and the engine decides custody per item at admission (design 4.5).
export function admissionBatches(injections: readonly QueuedInjection[]) {
  if (injections.length === 0) return []
  const contents = injections.map(injection => injection.content)
  const ranges: (readonly [number, number])[] = []
  let offset = 0
  for (const content of contents) {
    ranges.push([offset, offset + content.length])
    offset += content.length + 2
  }
  const details = injections.flatMap((item, index) => item.customType === undefined ? [] : [{
    customType: item.customType, details: item.details,
    ...(item.contextScoped === true ? { contentRange: ranges[index] ?? [0, 0] } : {}),
  }])
  const message: IdleInjectionMessage = { customType: "omo-senpi:wake", content: contents.join("\n\n"), display: false, details }
  return [{
    injections,
    message,
    items: injections.map(({ itemId, source, runRef, customType, details, display, contextScoped }, index): AdmissionItem => ({
      itemId, producer: source, content: contents[index] ?? "", contentRange: ranges[index] ?? [0, 0],
      ...(runRef === undefined ? {} : { runRef }),
      ...(customType === undefined ? {} : { customType }),
      ...(details === undefined ? {} : { details }),
      ...(display === undefined ? {} : { display }),
      ...(contextScoped === undefined ? {} : { contextScoped }),
    })),
  }]
}

// Every entry (superseded ones included) gets its receipt in its own try; the errors come back to the caller.
export function failItems(injections: readonly QueuedInjection[], error: unknown): ReceiptErrors {
  return runReceipts(injections.flatMap(withSuperseded), entry => entry.onDeliveryFailed?.(error))
}

export function settleItemReceipts(injections: readonly QueuedInjection[], result: unknown): ReceiptErrors {
  // A host with no custody receipts retains its synchronous successful-send contract.
  const custody = result !== undefined && Array.isArray(result)
  const entries = injections.flatMap(injection => {
    const receipt: unknown = custody ? result.find(value => isReceipt(value) && value.itemId === injection.itemId) : undefined
    return withSuperseded(injection).map(entry => ({ entry, itemId: injection.itemId, receipt }))
  })
  return runReceipts(entries, ({ entry, itemId, receipt }) => {
    if (!custody) entry.onFlushed?.()
    else if (!isReceipt(receipt)) entry.onDeliveryFailed?.(new Error(`missing custody receipt for ${itemId}`))
    // A held notice is engine custody: a producer that does not track holds treats it as delivered.
    else if (receipt.disposition === "notice_persisted" && entry.onHeld !== undefined) entry.onHeld(receipt)
    else entry.onFlushed?.()
  })
}

function isReceipt(value: unknown): value is ItemReceipt {
  return typeof value === "object" && value !== null && "itemId" in value && typeof value.itemId === "string"
    && "entryId" in value && typeof value.entryId === "string" && "disposition" in value
    && (value.disposition === "notice_persisted" || value.disposition === "message_persisted")
}
