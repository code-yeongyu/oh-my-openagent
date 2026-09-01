import type { Messageability, ResidencyState, TaskStatus } from "./types"

export function messageability(status: TaskStatus, residencyState: ResidencyState): Messageability {
  // Suspended residencies are never continuable through task_send, for ANY status: messaging a
  // suspended child must not wake it (no lazy revive-on-send) - resume its session instead.
  if (residencyState === "disposed" || residencyState === "persisted_only" || residencyState === "rpc_detached") {
    return "not-continuable"
  }
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
