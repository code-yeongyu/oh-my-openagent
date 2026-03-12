import type { BackgroundManager } from "../background-agent"
import { markTeamWorkersLaunched } from "./runtime"
import type { LaunchTeamWorkersInput, TeamWorkerLaunchRecord } from "./types"
import { createTeamWorkerPrompt } from "./worker-bootstrap"

const VERIFIED_LAUNCH_TIMEOUT_MS = 5_000
const VERIFIED_LAUNCH_POLL_INTERVAL_MS = 50

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key]
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function extractVerifiedLaunchRecord(input: {
  workerId: string
  backgroundTaskId: string
  task: ReturnType<BackgroundManager["getTask"]>
}): TeamWorkerLaunchRecord | null {
  const { workerId, backgroundTaskId, task } = input
  if (!task?.sessionID) {
    return null
  }

  const taskRecord = task as unknown as Record<string, unknown>
  const tmuxRecord = getNestedRecord(taskRecord, "tmux")
  const attachRecord = getNestedRecord(taskRecord, "attach")
  const paneId =
    getString(taskRecord, "paneId") ??
    getString(taskRecord, "tmuxPaneId") ??
    getString(attachRecord ?? {}, "paneId") ??
    getString(tmuxRecord ?? {}, "paneId")
  const windowId =
    getString(taskRecord, "windowId") ??
    getString(taskRecord, "tmuxWindowId") ??
    getString(attachRecord ?? {}, "windowId") ??
    getString(tmuxRecord ?? {}, "windowId")

  if (!paneId || !windowId) {
    return null
  }

  return {
    id: workerId,
    backgroundTaskId,
    sessionID: task.sessionID,
    paneId,
    windowId,
  }
}

async function waitForVerifiedLaunchRecord(input: {
  backgroundManager: BackgroundManager
  workerId: string
  backgroundTaskId: string
}): Promise<TeamWorkerLaunchRecord> {
  const deadline = Date.now() + VERIFIED_LAUNCH_TIMEOUT_MS

  while (Date.now() <= deadline) {
    const task = input.backgroundManager.getTask(input.backgroundTaskId)
    const verified = extractVerifiedLaunchRecord({
      workerId: input.workerId,
      backgroundTaskId: input.backgroundTaskId,
      task,
    })
    if (verified) {
      return verified
    }

    await new Promise((resolve) => setTimeout(resolve, VERIFIED_LAUNCH_POLL_INTERVAL_MS))
  }

  throw new Error(`Missing verified tmux launch metadata for ${input.workerId}`)
}

export async function launchTeamWorkers(
  backgroundManager: BackgroundManager,
  input: LaunchTeamWorkersInput,
): Promise<TeamWorkerLaunchRecord[]> {
  const launchedWorkers: TeamWorkerLaunchRecord[] = []

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
      forceTmuxPane: true,
    })
    launchedWorkers.push(
      await waitForVerifiedLaunchRecord({
        backgroundManager,
        workerId,
        backgroundTaskId: task.id,
      }),
    )
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
}): Promise<TeamWorkerLaunchRecord[]> {
  const launchedWorkers = await launchTeamWorkers(input.backgroundManager, {
    sessionID: input.sessionID,
    parentMessageID: input.parentMessageID,
    planName: input.planName,
    teamStatePath: input.teamStatePath,
    workerIds: input.workerIds,
    worktreePath: input.worktreePath,
  })

  markTeamWorkersLaunched(input.directory, input.teamId, launchedWorkers)
  return launchedWorkers
}
