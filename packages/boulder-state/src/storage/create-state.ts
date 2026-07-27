import type { BoulderState, BoulderWorkState } from "../types"
import { getPlanName } from "./plan-progress"
import { normalizeSessionId, nowIsoString } from "./shared"

export function generateWorkId(planName: string): string {
  const slug = planName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const randomHex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0")
  return `${slug.length > 0 ? slug : "work"}-${randomHex}`
}

export function createBoulderState(
  planPath: string,
  sessionId: string,
  agent?: string,
  worktreePath?: string,
): BoulderState {
  const startedAt = nowIsoString()
  const normalizedSessionId = normalizeSessionId(sessionId)
  const workId = generateWorkId(getPlanName(planPath))
  const work: BoulderWorkState = {
    work_id: workId,
    active_plan: planPath,
    plan_name: getPlanName(planPath),
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
    task_sessions: {},
  }

  return {
    schema_version: 2,
    active_work_id: workId,
    works: { [workId]: work },
    active_plan: planPath,
    started_at: startedAt,
    status: "active",
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    plan_name: getPlanName(planPath),
    task_sessions: {},
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
  }
}
