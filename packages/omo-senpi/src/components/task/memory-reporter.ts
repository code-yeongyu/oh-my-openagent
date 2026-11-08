import type { TaskRecordStoreResidentFigures } from "@oh-my-opencode/senpi-task"
import type { SenpiExtensionAPI } from "../../extension/types"

export interface TaskMemorySource {
  residentTaskIds(): readonly string[]
  residentFigures(): TaskRecordStoreResidentFigures
}

/**
 * The task-child layer of senpi's on-demand memory report (oh-my-openagent#9442): children this
 * session holds resident and the task records its store keeps parsed. Read only when a report is taken.
 */
export function registerTaskMemoryReporter(pi: Pick<SenpiExtensionAPI, "registerMemoryReporter">, source: TaskMemorySource): void {
  pi.registerMemoryReporter?.("omoTask", () => ({
    residentChildren: source.residentTaskIds().length,
    ...source.residentFigures(),
  }))
}
