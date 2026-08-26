import {
  getPlanChecklist,
  getWorkForSession,
  resolveBoulderPlanPathForWork,
  type BoulderWorkState,
  type PlanChecklist,
} from "@oh-my-opencode/boulder-state"

export interface ContinuableWork {
  readonly work: BoulderWorkState
  readonly planPath: string
  readonly checklist: PlanChecklist
}

export function findContinuableBoulderWork(
  cwd: string,
  sessionId: string,
): ContinuableWork | null {
  const work = getWorkForSession(cwd, `senpi:${sessionId}`)
  if (!work) {
    return null
  }

  if (work.status !== "active" && work.status !== "paused") {
    return null
  }

  const planPath = resolveBoulderPlanPathForWork(cwd, work)
  const checklist = getPlanChecklist(planPath)
  if (checklist.total <= 0) {
    return null
  }

  return { work, planPath, checklist }
}

