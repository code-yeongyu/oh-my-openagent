import type { TaskManager } from "@oh-my-opencode/senpi-task"
import type { DagRunId, OwnedStartResult } from "@oh-my-opencode/senpi-task/dag"

/** The task manager a DAG scheduler admits through: a run whose admission was stopped starts nothing more. */
export function admissionTaskManager(
  manager: TaskManager,
  admissionStopped: (runId: DagRunId) => boolean,
): TaskManager {
  return new Proxy(manager, {
    get(target, property) {
      if (property === "startOwned") {
        return (spec: Parameters<TaskManager["startOwned"]>[0], owner: Parameters<TaskManager["startOwned"]>[1]) => {
          if (admissionStopped(owner.runId)) return stoppedAdmission()
          return target.startOwned({ ...spec, run_in_background: false }, owner)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function stoppedAdmission(): Promise<OwnedStartResult> {
  return new Promise<OwnedStartResult>(() => undefined)
}
