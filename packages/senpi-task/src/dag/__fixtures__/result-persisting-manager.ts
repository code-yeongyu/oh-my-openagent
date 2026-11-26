// A TaskManager whose terminal wait persists a completed DAG child's result, as the runtime's adapter does.
import type { TaskManager } from "../../manager/types"
import { persistDagNodeResult } from "../results"
import type { DagFileStore } from "../store"

export function resultPersistingManager(manager: TaskManager, store: DagFileStore): TaskManager {
  return new Proxy(manager, {
    get(target, property) {
      if (property !== "waitFor") {
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      }
      return async (taskId: string, options?: { readonly signal?: AbortSignal }) => {
        const record = await target.waitFor(taskId, options)
        const owner = record.owner
        if (owner?.kind === "dag" && record.status === "completed") {
          const persisted = persistDagNodeResult({ store, runId: owner.runId, nodeId: owner.nodeId, record })
          if (persisted.kind === "failed") throw new Error(persisted.diagnostic.message)
        }
        return record
      }
    },
  })
}
