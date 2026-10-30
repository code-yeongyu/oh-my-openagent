import {
  getPlanChecklist,
  getWorkForSession,
  reconcileStaleWorks,
  resolveBoulderPlanPathForWork,
  type BoulderWorkState,
  type PlanChecklist,
} from "@oh-my-opencode/boulder-state"
import { resolveHomeDir } from "@oh-my-opencode/omo-config-core"

import { resolveAgentSessionsDirectory } from "../agent-home/resolve-agent-home"

export interface ContinuableWork {
  readonly work: BoulderWorkState
  readonly planPath: string
  readonly checklist: PlanChecklist
}

export function findContinuableBoulderWork(
  cwd: string,
  sessionId: string,
): ContinuableWork | null {
  // The record is read here anyway, so this is where a work abandoned by a dead session gets
  // repaired: a session that never completed its work leaves it `active` forever otherwise (#8413).
  reconcileStaleWorks(cwd, {
    sessionsDirectory: resolveAgentSessionsDirectory({ env: process.env, homeDir: resolveHomeDir(process.env) }),
  })

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

