import type { RunRef } from "../../../senpi-task/src/pause/ports"
import type { IdleInjectionMessage } from "./idle-injection-coordinator"
import type { AdmissionItem, ItemReceipt } from "./idle-injection-items"

export type NativeAdmissionItem = {
  readonly itemId: string
  readonly producer: string
  readonly contentRange: readonly [number, number]
  readonly runRef?: RunRef
}

type NativeSender = (
  message: IdleInjectionMessage,
  options: {
    readonly triggerTurn: true
    readonly deliverAs: "steer" | "followUp"
    readonly items: readonly NativeAdmissionItem[]
  },
) => unknown

// One flush is one sendMessage (design 4.5): the items name each wake inside it, and an engine that
// understands them answers one receipt per item. An engine that predates items ignores the option
// and answers nothing, which keeps its synchronous delivered-on-return contract.
export async function deliverItems(
  send: NativeSender,
  options: { readonly message: IdleInjectionMessage; readonly items: readonly AdmissionItem[]; readonly deliverAs: "steer" | "followUp" },
): Promise<readonly ItemReceipt[] | undefined> {
  const result = await send(options.message, {
    triggerTurn: true, deliverAs: options.deliverAs,
    items: options.items.map(item => ({
      itemId: item.itemId, producer: item.producer, contentRange: item.contentRange,
      ...(item.runRef === undefined ? {} : { runRef: item.runRef }),
    })),
  })
  return Array.isArray(result) ? result : undefined
}
