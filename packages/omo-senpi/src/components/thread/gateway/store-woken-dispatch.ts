import type { StoreContext } from "./store-ops"
import * as marks from "./store-intake-marks-ops"
import * as wait from "./store-session-wait-ops"
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
    case "woken_clear_waiting":
      return await woken.clearWaiting(ctx, args as Parameters<typeof woken.clearWaiting>[1])
    case "woken_end":
      return await woken.endWake(ctx, args as Request<"end">)
    case "woken_gated":
      return woken.isGated(ctx, args as Request<"gated">)
    case "woken_list":
      return woken.listWoken(ctx)
    case "woken_count_wake":
      return await wait.countWake(ctx, args as Parameters<typeof wait.countWake>[1])
    case "woken_wake_count":
      return wait.wakeCount(ctx, args as Parameters<typeof wait.wakeCount>[1])
    case "woken_reset_count":
      return await wait.resetCount(ctx, args as Parameters<typeof wait.resetCount>[1])
    case "woken_session_work":
      return wait.sessionWork(ctx, args as Parameters<typeof wait.sessionWork>[1])
    case "woken_wait_write":
      return await wait.writeWait(ctx, args as Parameters<typeof wait.writeWait>[1])
    case "woken_wait_read":
      return wait.readWait(ctx, args as Parameters<typeof wait.readWait>[1])
    case "woken_wait_clear":
      return await wait.clearWait(ctx, args as Parameters<typeof wait.clearWait>[1])
    case "woken_waiting_on":
      return wait.waitingOn(ctx, args as Parameters<typeof wait.waitingOn>[1])
    case "woken_mark_record":
      return await marks.recordIntakeCommand(ctx, args as Parameters<typeof marks.recordIntakeCommand>[1])
    case "woken_mark_marked":
      return marks.markedPairs(ctx)
    case "woken_mark_pending":
      return marks.pendingMarks(ctx)
    case "woken_mark_drained":
      return await marks.drainedMark(ctx, args as Parameters<typeof marks.drainedMark>[1])
    case "woken_command_for":
      return marks.commandFor(ctx, args as Parameters<typeof marks.commandFor>[1])
    case "woken_open_for_command":
      return marks.openForCommand(ctx, args as Parameters<typeof marks.openForCommand>[1])
    case "woken_open_sessions":
      return await marks.openIntakeSessions(ctx)
    default:
      throw new Error(`unknown gateway store op ${op}`)
  }
}
