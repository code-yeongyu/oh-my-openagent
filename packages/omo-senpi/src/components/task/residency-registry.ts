import type { ResidencyRegistry, ResidentHandle } from "@oh-my-opencode/senpi-task"
import type { ManagedChildHandle, TaskManager } from "@oh-my-opencode/senpi-task"

type ResidencyManager = Pick<TaskManager, "forget" | "get" | "getResidentHandle" | "hasPendingSends" | "residentTaskIds"> &
  Partial<Pick<TaskManager, "isEvicting" | "releaseEviction" | "tryBeginSend" | "tryClaimEviction" | "endSend">>

// W1-V F3/F7: the lifecycle's ResidencyRegistry is a VIEW over the manager's live handles, and its
// forget() delegates to manager.forget() so the registry and the manager's #live map share one
// prune path (no stale handle after eviction, no unbounded growth). The manager is passed by accessor
// because lifecycle (which owns the registry) is constructed before the manager in the composition.
export function createManagerResidencyRegistry(getManager: () => ResidencyManager): ResidencyRegistry {
  return {
    get: (taskId) => toResidentHandle(getManager().getResidentHandle(taskId)),
    entries: () =>
      getManager()
        .residentTaskIds()
        .map((taskId) => toResidentHandle(getManager().getResidentHandle(taskId)))
        .filter((handle): handle is ResidentHandle => handle !== undefined),
    forget: (taskId) => getManager().forget(taskId),
    // The durable steering queue is the steering engine's source of truth. A queued message must
    // keep its resident alive until it is delivered or explicitly dropped.
    hasPendingSends: (taskId) => getManager().hasPendingSends?.(taskId) ?? false,
    tryClaimEviction: (taskId) => getManager().tryClaimEviction?.(taskId) ?? true,
    releaseEviction: (taskId) => getManager().releaseEviction?.(taskId),
    isEvicting: (taskId) => getManager().isEvicting?.(taskId) ?? false,
    tryBeginSend: (taskId) => getManager().tryBeginSend?.(taskId) ?? true,
    endSend: (taskId) => getManager().endSend?.(taskId),
  }
}

function toResidentHandle(handle: ManagedChildHandle | undefined): ResidentHandle | undefined {
  if (handle === undefined) return undefined
  // The runner states its own kind. Deriving it from `pid` cannot tell an in-process child from a
  // daemon SESSION - both have none - and getting that wrong silently disarms the session teardown.
  // Handles from before the field shipped are in-process by construction.
  const kind = handle.kind ?? "in-process"
  return {
    task_id: handle.task_id,
    kind,
    pid: handle.pid,
    abort: () => handle.abort(),
    dispose: () => handle.dispose(),
    terminate: () => {
      // in-process: no OS process and no session. rpc: SIGTERM/SIGKILL. host-session: the handle's
      // terminate is `abort` + `close_session` - the ONLY way a daemon session ends.
      if (kind === "in-process") return Promise.resolve()
      if (handle.terminate === undefined) {
        return Promise.reject(new TypeError(`rpc resident ${handle.task_id} has no terminate port`))
      }
      return handle.terminate()
    },
  }
}
