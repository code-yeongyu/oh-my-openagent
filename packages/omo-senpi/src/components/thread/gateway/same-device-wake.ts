import { resolveWakeTarget } from "../wake/session-target"
import type { GatewayStore } from "./store"
import type { GatewayDeliveryResult } from "./types"

/** The carrier of this process, when it runs one: it takes a requested wake row and starts the session. */
export type SameDeviceCarrier = { readonly wake: (durableId: string) => Promise<void> }

export type SameDeviceWakeOptions = {
  readonly store: GatewayStore
  readonly sessionsDirectory: string
  /** `session_wake.same_device`, read per send; on unless the machine's omo configuration opts out. */
  readonly enabled: () => boolean
  readonly carrier?: SameDeviceCarrier
}

export type SameDeviceWake = {
  /** Called with a send's answer; a `queued_offline` answer for a wakeable session becomes a requested wake (5.3). */
  readonly afterSend: (result: GatewayDeliveryResult) => Promise<GatewayDeliveryResult>
}

export function createSameDeviceWake(options: SameDeviceWakeOptions): SameDeviceWake {
  return {
    afterSend: async (result) => {
      if (result.kind !== "ok" || result.delivery.kind !== "queued_offline" || !options.enabled()) return result
      const target = resolveWakeTarget(options.sessionsDirectory, result.thread_id)
      if (target.kind !== "found" || target.session_kind !== "interactive") return result
      await options.store.woken.request({ durable_id: result.thread_id, session_file: target.session_path })
      const { queue_position } = result.delivery
      if (options.carrier === undefined)
        return { ...result, delivery: { kind: "queued_offline", queue_position, reason: "wake_unavailable" } }
      void options.carrier.wake(result.thread_id).catch(() => undefined)
      return { ...result, delivery: { kind: "queued", queue_position, waiting_on: { kind: "wake" } } }
    },
  }
}
