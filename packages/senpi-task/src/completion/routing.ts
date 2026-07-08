import type { TaskStatus } from "../state"
import type { NotificationConfig, ParentState, RoutingDecision } from "./types"

const notifyingStatuses = new Set<TaskStatus>(["completed", "error", "lost"])

// Only externally-caused terminals (completed/error/lost) notify. Parent-initiated cancel/interrupt
// return synchronously in the tool result, so they must never push a completion notification.
export function shouldNotifyStatus(status: TaskStatus): boolean {
  return notifyingStatuses.has(status)
}

// An idle parent ALWAYS wakes: a completed background child's notification must unconditionally reach
// the parent's next turn, with no config able to suppress it. A streaming parent delivers with the
// configured deliver_as (and the notifier also stamps triggerTurn so the queued message still fires a
// turn). Transient transitions buffer and flush with triggerTurn on the next session_start/idle edge.
export function routeCompletion(parentState: ParentState, config: NotificationConfig): RoutingDecision {
  switch (parentState.kind) {
    case "idle":
      return { kind: "wake" }
    case "streaming":
      return { kind: "deliver_streaming", deliverAs: config.deliver_as }
    case "compacting":
      return { kind: "buffer", reason: "compacting" }
    case "session_switching":
      return { kind: "buffer", reason: "session_switching" }
    case "session_shutdown":
      return { kind: "buffer", reason: "session_shutdown" }
    default:
      return assertNever(parentState)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected parent state: ${JSON.stringify(value)}`)
}
