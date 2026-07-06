import type { TaskStatus } from "../state"
import type { NotificationConfig, ParentState, RoutingDecision } from "./types"

const notifyingStatuses = new Set<TaskStatus>(["completed", "error", "lost"])

// Only externally-caused terminals (completed/error/lost) notify. Parent-initiated cancel/interrupt
// return synchronously in the tool result, so they must never push a completion notification.
export function shouldNotifyStatus(status: TaskStatus): boolean {
  return notifyingStatuses.has(status)
}

export function routeCompletion(parentState: ParentState, config: NotificationConfig): RoutingDecision {
  switch (parentState.kind) {
    case "idle":
      return config.wake_idle_parent ? { kind: "wake" } : { kind: "queue_silently" }
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
