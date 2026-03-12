import type { BackgroundManager } from "../background-agent"
import { markTeamWorkersLaunched } from "./runtime"
import type { LaunchTeamWorkersInput } from "./types"
import { createTeamWorkerPrompt } from "./worker-bootstrap"

export async function launchTeamWorkers(
  backgroundManager: BackgroundManager,
  input: LaunchTeamWorkersInput,
): Promise<Array<{ id: string; backgroundTaskId: string }>> {
  const launchedWorkers: Array<{ id: string; backgroundTaskId: string }> = []

  for (const workerId of input.workerIds) {
    const task = await backgroundManager.launch({
      description: `Team Mode ${workerId}: ${input.planName}`,
      prompt: createTeamWorkerPrompt({
        workerId,
        planName: input.planName,
        teamStatePath: input.teamStatePath,
        worktreePath: input.worktreePath,
      }),
      agent: "atlas",
      parentSessionID: input.sessionID,
      parentMessageID: input.parentMessageID ?? "teammode",
      parentAgent: "atlas",
    })
    launchedWorkers.push({ id: workerId, backgroundTaskId: task.id })
  }

  return launchedWorkers
}

export async function bootstrapTeamModeRun(input: {
  backgroundManager: BackgroundManager
  directory: string
  teamId: string
  sessionID: string
  parentMessageID?: string
  planName: string
  teamStatePath: string
  workerIds: string[]
  worktreePath?: string
}): Promise<void> {
  const launchedWorkers = await launchTeamWorkers(input.backgroundManager, {
    sessionID: input.sessionID,
    parentMessageID: input.parentMessageID,
    planName: input.planName,
    teamStatePath: input.teamStatePath,
    workerIds: input.workerIds,
    worktreePath: input.worktreePath,
  })

  markTeamWorkersLaunched(input.directory, input.teamId, launchedWorkers)
}
