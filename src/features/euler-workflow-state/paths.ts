import { join, dirname } from "path"
import { existsSync, mkdirSync } from "fs"

export const WORKFLOW_STATE_DIR = ".agentic-loop"
export const WORKFLOW_STATE_FILE = "workflow-state.json"

export function getWorkflowStatePath(projectRoot: string): string {
  return join(projectRoot, WORKFLOW_STATE_DIR, WORKFLOW_STATE_FILE)
}

export function ensureStateDirectory(projectRoot: string): string {
  const statePath = getWorkflowStatePath(projectRoot)
  const stateDir = dirname(statePath)

  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true })
  }

  return stateDir
}
