import type { RuntimeState } from "../types"
import type { WorkerLiveness } from "./session-liveness"

export interface WorkerResumeStatus {
  readonly deadWorkerNames: readonly string[]
  readonly hasAliveWorker: boolean
  readonly hasAnyWorker: boolean
}

export function summarizeWorkerLiveness(workerCheckResults: readonly WorkerLiveness[]): WorkerResumeStatus {
  return {
    deadWorkerNames: workerCheckResults
      .filter((result) => result.wasSpawned && !result.stillAlive)
      .map((result) => result.name),
    hasAliveWorker: workerCheckResults.some((result) => result.stillAlive),
    hasAnyWorker: workerCheckResults.length > 0,
  }
}

export function markDeadWorkersErrored(
  runtimeState: RuntimeState,
  deadWorkerNames: readonly string[],
): RuntimeState {
  const deadWorkerNameSet = new Set(deadWorkerNames)

  return {
    ...runtimeState,
    members: runtimeState.members.map((member) => (
      deadWorkerNameSet.has(member.name)
        ? { ...member, status: "errored" as const, sessionId: undefined }
        : member
    )),
  }
}
