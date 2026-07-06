import type { ResidencyRegistry, ResidentHandle } from "@oh-my-opencode/senpi-task"
import type { ManagedChildHandle, TaskManager } from "@oh-my-opencode/senpi-task"

// W1-V F3/F7: the lifecycle's ResidencyRegistry is a VIEW over the manager's live handles, and its
// forget() delegates to manager.forget() so the registry and the manager's #live map share one
// prune path (no stale handle after eviction, no unbounded growth). The manager is passed by accessor
// because lifecycle (which owns the registry) is constructed before the manager in the composition.
export function createManagerResidencyRegistry(getManager: () => TaskManager): ResidencyRegistry {
  return {
    get: (taskId) => toResidentHandle(getManager().getResidentHandle(taskId)),
    entries: () =>
      getManager()
        .residentTaskIds()
        .map((taskId) => toResidentHandle(getManager().getResidentHandle(taskId)))
        .filter((handle): handle is ResidentHandle => handle !== undefined),
    forget: (taskId) => getManager().forget(taskId),
    // Pending-send tracking lives inside the steering engine; the LRU victim scan treats every
    // resident as send-free here. v1: a queued send does not block eviction through this bridge.
    hasPendingSends: () => false,
  }
}

function toResidentHandle(handle: ManagedChildHandle | undefined): ResidentHandle | undefined {
  if (handle === undefined) return undefined
  // pid is defined for rpc children only; in-process children have no OS process to signal, so their
  // terminate() is a no-op (dispose tears the session down).
  const kind = handle.pid === undefined ? "in-process" : "rpc"
  return {
    task_id: handle.task_id,
    kind,
    pid: handle.pid,
    abort: () => handle.abort(),
    dispose: () => handle.dispose(),
    terminate: () => (kind === "rpc" ? handle.abort() : Promise.resolve()),
  }
}
