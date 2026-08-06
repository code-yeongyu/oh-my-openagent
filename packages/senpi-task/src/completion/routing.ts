import type { TaskStatus } from "../state"
import type { ParentState, RoutingDecision } from "./types"

const notifyingStatuses = new Set<TaskStatus>(["completed", "error", "lost"])

// Only externally-caused terminals (completed/error/lost) notify. Parent-initiated cancel/interrupt
// return synchronously in the tool result, so they must never push a completion notification.
export function shouldNotifyStatus(status: TaskStatus): boolean {
  return notifyingStatuses.has(status)
}

// Delivery is unconditional: an idle parent ALWAYS wakes and a streaming parent ALWAYS receives the
// notification steered into its running turn at the next tool-call boundary - no config can suppress,
// delay, or split it. Transient transitions buffer and flush on the next session_start/idle edge.
export function routeCompletion(parentState: ParentState): RoutingDecision {
  switch (parentState.kind) {
    case "idle":
      return { kind: "wake" }
    case "streaming":
      return { kind: "deliver_streaming" }
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
