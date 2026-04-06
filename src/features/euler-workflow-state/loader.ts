import { existsSync, readFileSync, writeFileSync } from "fs"
import { log } from "../../shared"
import { getWorkflowStatePath, ensureStateDirectory } from "./paths"
import type { WorkflowState, WorkflowPhase } from "./types"

const DEFAULT_STATE: WorkflowState = {
  phase: "idle",
  lastUpdated: new Date().toISOString(),
  reviewIterations: 0,
}

export function loadWorkflowState(projectRoot: string): WorkflowState {
  const statePath = getWorkflowStatePath(projectRoot)

  if (!existsSync(statePath)) {
    return { ...DEFAULT_STATE }
  }

  try {
    const content = readFileSync(statePath, "utf-8")
    return JSON.parse(content) as WorkflowState
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveWorkflowState(
  projectRoot: string,
  state: WorkflowState
): void {
  ensureStateDirectory(projectRoot)
  const statePath = getWorkflowStatePath(projectRoot)

  const updatedState: WorkflowState = {
    ...state,
    lastUpdated: new Date().toISOString(),
  }

  writeFileSync(statePath, JSON.stringify(updatedState, null, 2))
  log("[euler-workflow] Saved state:", { phase: updatedState.phase })
}

export function resetWorkflowState(projectRoot: string): void {
  saveWorkflowState(projectRoot, { ...DEFAULT_STATE })
  log("[euler-workflow] Reset state to idle")
}

const VALID_PHASE_TRANSITIONS: Record<WorkflowPhase, WorkflowPhase[]> = {
  idle: ["planning"],
  planning: ["reviewing", "failed"],
  reviewing: ["executing", "planning", "failed"],
  executing: ["deploying", "failed"],
  deploying: ["testing", "failed"],
  testing: ["completed", "failed"],
  completed: ["planning"],
  failed: ["planning"],
}

export function isValidPhaseTransition(
  from: WorkflowPhase,
  to: WorkflowPhase
): boolean {
  return VALID_PHASE_TRANSITIONS[from].includes(to)
}

export function transitionPhase(
  projectRoot: string,
  newPhase: WorkflowPhase,
  metadata?: Partial<WorkflowState>
): WorkflowState {
  const currentState = loadWorkflowState(projectRoot)

  if (!isValidPhaseTransition(currentState.phase, newPhase)) {
    throw new Error(`Invalid phase transition: ${currentState.phase} → ${newPhase}`)
  }

  const newState: WorkflowState = {
    ...currentState,
    phase: newPhase,
    ...metadata,
  }

  saveWorkflowState(projectRoot, newState)
  return newState
}
