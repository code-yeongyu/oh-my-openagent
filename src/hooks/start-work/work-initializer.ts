import {
  addBoulderWork,
  createBoulderState,
  writeBoulderState,
} from "../../features/boulder-state"
import { buildAutoSelectedPlanContextInfoOnly } from "./context-info-formatters"

export function createNewWorkOrInitialize(params: {
  readonly directory: string
  readonly planPath: string
  readonly sessionId: string
  readonly activeAgent: string
  readonly worktreePath: string | undefined
}): void {
  const { directory, planPath, sessionId, activeAgent, worktreePath } = params
  const created = addBoulderWork(directory, {
    planPath,
    sessionId,
    agent: activeAgent,
    worktreePath,
  })

  if (!created) {
    const initializedState = createBoulderState(planPath, sessionId, activeAgent, worktreePath)
    writeBoulderState(directory, initializedState)
  }
}

export function buildAutoSelectedPlanContextWithStateInit(params: {
  readonly planPath: string
  readonly sessionId: string
  readonly timestamp: string
  readonly activeAgent: string
  readonly worktreePath: string | undefined
  readonly worktreeBlock: string
  readonly directory: string
  readonly reason?: string
}): string {
  const { planPath, sessionId, timestamp, activeAgent, worktreePath, worktreeBlock, directory, reason } =
    params

  const newState = createBoulderState(planPath, sessionId, activeAgent, worktreePath)
  writeBoulderState(directory, newState)

  return buildAutoSelectedPlanContextInfoOnly({
    planPath,
    sessionId,
    timestamp,
    worktreeBlock,
    reason,
  })
}
