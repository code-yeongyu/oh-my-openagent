import {
  addBoulderWork,
  createBoulderState,
  getPlanName,
  writeBoulderState,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { buildAutoSelectedPlanContextInfoOnly } from "./context-info-formatters"
import { ensureNotepadScaffold } from "./notepad-scaffold"

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
    const written = writeBoulderState(directory, initializedState)
    if (!written.ok) log("[ulw-execute] boulder state write failed", { error: written.error.message, code: written.error.code })
  }

  ensureNotepadScaffold({ directory, planName: getPlanName(planPath) })
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
  const written = writeBoulderState(directory, newState)
  if (!written.ok) log("[ulw-execute] boulder state write failed", { error: written.error.message, code: written.error.code })

  ensureNotepadScaffold({ directory, planName: getPlanName(planPath), timestamp })

  return buildAutoSelectedPlanContextInfoOnly({
    planPath,
    sessionId,
    timestamp,
    worktreeBlock,
    reason,
  })
}
