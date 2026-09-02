import type { ParentNotifier, ParentNotifierMessage } from "./types"

export type DeliveryAttempt =
  | { readonly kind: "acknowledged" }
  | { readonly kind: "pending"; readonly receipt: Promise<void> }
  | { readonly kind: "rejected"; readonly error: unknown }

export function attemptDeliveryWithSyncRetry(
  notifier: ParentNotifier,
  message: ParentNotifierMessage,
): DeliveryAttempt {
  const first = attemptDelivery(notifier, message)
  return first.kind === "rejected" ? attemptDelivery(notifier, message) : first
}

function attemptDelivery(notifier: ParentNotifier, message: ParentNotifierMessage): DeliveryAttempt {
  try {
    const receipt = notifier.enqueue(message)
    return receipt === undefined ? { kind: "acknowledged" } : { kind: "pending", receipt }
  } catch (error) {
    return {
      kind: "rejected",
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
