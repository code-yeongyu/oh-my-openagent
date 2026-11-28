import type { TaskManager } from "../../manager/types"
import type { ResidencyRegistry, ResidentHandle } from "../port"

/** The lifecycle's residency view over the fixture's CURRENT task manager (replaced on restart). */
export function managerResidencyRegistry(
  manager: () => TaskManager,
  mode: "in-process" | "child-process" | "host-session",
  owns: (record: { readonly parent_session_id: string }) => boolean,
) {
  const registry = {
    get: (id: string): ResidentHandle | undefined => {
      const handle = manager().getResidentHandle(id)
      return handle === undefined
        ? undefined
        : {
            task_id: id,
            kind: mode === "child-process" ? "rpc" : mode,
            pid: handle.pid,
            abort: handle.abort,
            dispose: handle.dispose,
            terminate: handle.terminate ?? (async () => undefined),
          }
    },
    entries: (): readonly ResidentHandle[] =>
      manager()
        .residentTaskIds()
        .flatMap((id) => {
          const handle = registry.get(id)
          return handle === undefined ? [] : [handle]
        }),
    forget: (id: string, options: Parameters<ResidencyRegistry["forget"]>[1]) => manager().forget(id, options),
    hasPendingSends: () => false,
    ownsRecord: owns,
  }
  return registry
}
