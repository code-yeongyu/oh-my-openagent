import type { HostSessionIdentity, Messageability, ResidencyState, RunnerKind, TaskStatus } from "./types"

export function messageability(
  status: TaskStatus,
  residencyState: ResidencyState,
  executionMode?: string,
  killed?: boolean,
  runnerKind?: RunnerKind,
  hostSession?: HostSessionIdentity,
  isDaemonReachable?: (hostSession: HostSessionIdentity) => boolean,
): Messageability {
  if (killed === true) return "not-continuable"
  // Persisted-only children keep the session-resume contract. A terminal RPC child is different:
  // its completed transcript can be reattached lazily when task_send explicitly targets it.
  if (residencyState === "disposed" || residencyState === "persisted_only") return "not-continuable"
  // Host-session children: a PARKED session (the daemon evicted it, or the daemon died mid-turn) is
  // reopened from its transcript and delivered to, so `running` is revivable here too - the record
  // names no live process anyone could talk over. Key on session_path + routing_id, never on
  // instance_id (which rotates on handoff). With no reachability check, default to not-continuable.
  if (residencyState === "rpc_detached" && runnerKind === "host-session" && hostSession !== undefined) {
    const daemonReachable = isDaemonReachable?.(hostSession) ?? false
    if (!daemonReachable) return "not-continuable"
    switch (status) {
      case "completed":
      case "error":
      case "interrupted":
      case "running":
        return "revive"
      case "pending":
      case "cancelled":
      case "lost":
        return "not-continuable"
      default:
        return assertNever(status)
    }
  }
  // Child-process runner: revive if terminal (legacy RPC behavior)
  if (residencyState === "rpc_detached" && executionMode === "process" && runnerKind !== "host-session") {
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
