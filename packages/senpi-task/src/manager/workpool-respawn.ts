import { createWorkpoolWorkerTool } from "../tools/workpool"
import type { WorkpoolEngine } from "../workpool/engine"
import { isTerminalRecord } from "./manager-helpers"
import { respawnManagedTask } from "./manager-respawn"
import { workpoolProcessLaunch } from "./workpool-process-launch"

export function respawnWithWorkpool(input: Parameters<typeof respawnManagedTask>[0], workpools: WorkpoolEngine, epoch: () => number) {
  if (!workpools.ownsTask(input.record.task_id)) return respawnManagedTask(input)
  if (!isTerminalRecord(input.record) || input.sessionPath === undefined || input.record.revive_delivery_uncertain !== undefined) return Promise.resolve({
    ok: false, disposition: "retryable", code: "tools_unavailable",
    reason: "Pool workers resume only terminal recorded turns without unresolved delivery; running work is never replayed.",
  } as const)
  const runner = input.runners["in-process"]
  const resume = runner.resume?.bind(runner)
  const memberScopedTools = [createWorkpoolWorkerTool({ workpools, taskId: input.record.task_id, runEpoch: epoch })]
  return respawnManagedTask({ ...input,
    runners: { ...input.runners, "in-process": {
      start: spec => runner.start(spec),
      ...(resume === undefined ? {} : { resume: (spec, path) => resume({ ...spec, memberScopedTools }, path) }),
    } },
    trustedLaunch: async () => workpoolProcessLaunch(input.stateDir, input.record.task_id),
  })
}
