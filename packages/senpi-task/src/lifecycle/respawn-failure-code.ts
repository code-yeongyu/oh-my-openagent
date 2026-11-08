import type { RespawnFailureCode } from "./port"
import type { ReconcileDeferredReason } from "./types"

export function isSuspendingCode(code: RespawnFailureCode): code is "host_draining" | "host_incompatible" | "store_index_unavailable" {
  return code === "host_draining" || code === "host_incompatible" || code === "store_index_unavailable"
}

export function deferredCode(code: RespawnFailureCode): ReconcileDeferredReason {
  return code === "respawn_failed" ? "session_unavailable" : code
}
