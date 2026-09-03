import type { Messageability, ResidencyState, TaskStatus } from "./types"

export function messageability(
  status: TaskStatus,
  residencyState: ResidencyState,
  executionMode?: string,
  killed?: boolean,
): Messageability {
  if (killed === true) return "not-continuable"
  // Persisted-only children keep the session-resume contract. A terminal RPC child is different:
  // its completed transcript can be reattached lazily when task_send explicitly targets it.
  if (residencyState === "disposed" || residencyState === "persisted_only") return "not-continuable"
  if (residencyState === "rpc_detached" && executionMode === "process") {
    switch (status) {
      case "completed":
      case "error":
      case "interrupted":
        return "revive"
      case "pending":
      case "running":
      case "cancelled":
      case "lost":
        return "not-continuable"
      default:
        return assertNever(status)
    }
  }
  if (residencyState === "rpc_detached") return "not-continuable"
  switch (status) {
    case "pending":
    case "running":
      return residencyState === "resident" ? "steer" : "not-continuable"
    case "completed":
    case "error":
    case "interrupted":
      return residencyState === "resident" ? "revive" : "not-continuable"
    case "cancelled":
    case "lost":
      return "not-continuable"
    default:
      return assertNever(status)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected task status: ${JSON.stringify(value)}`)
}
