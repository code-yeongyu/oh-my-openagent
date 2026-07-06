import type { Messageability, ResidencyState, TaskStatus } from "./types"

export function messageability(status: TaskStatus, residencyState: ResidencyState): Messageability {
  if (residencyState === "disposed") return "not-continuable"
  switch (status) {
    case "pending":
    case "running":
      if (residencyState === "evicted") return "not-continuable"
      return residencyState === "resident" ? "steer" : "revive"
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
