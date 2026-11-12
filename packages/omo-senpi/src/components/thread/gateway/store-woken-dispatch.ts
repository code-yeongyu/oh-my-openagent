import type { StoreContext } from "./store-ops"
import * as woken from "./store-woken-ops"
import type { WokenSessionStore } from "./woken-types"

export const WOKEN_OP_PREFIX = "woken_"

type Request<K extends keyof WokenSessionStore> = Parameters<WokenSessionStore[K]>[0] & { readonly now: number }

export async function dispatchWoken(ctx: StoreContext, op: string, args: unknown): Promise<unknown> {
  switch (op) {
    case "woken_request":
      return await woken.requestWake(ctx, args as Request<"request">)
    case "woken_start":
      return await woken.startWake(ctx, args as Request<"start">)
    case "woken_renew":
      return await woken.renewLease(ctx, args as Request<"renew">)
    case "woken_take_over":
      return await woken.takeOverWake(ctx, args as Request<"takeOver">)
    case "woken_set_state":
      return await woken.setWokenState(ctx, args as Request<"setState">)
    case "woken_record_waiting":
      return await woken.recordWaiting(ctx, args as Request<"recordWaiting">)
    case "woken_retry_later":
      return await woken.retryWakeLater(ctx, args as Request<"retryLater">)
    case "woken_end":
      return await woken.endWake(ctx, args as Request<"end">)
    case "woken_gated":
      return woken.isGated(ctx, args as Request<"gated">)
    case "woken_list":
      return woken.listWoken(ctx)
    default:
      throw new Error(`unknown gateway store op ${op}`)
  }
}
