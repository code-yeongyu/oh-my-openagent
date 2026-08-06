import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import { PROMETHEUS_PLANS_DIR } from "../constants"
import { parsePlanChecklist } from "../plan-checklist"
import type { PlanProgress } from "../types"

const LEGACY_PROMETHEUS_PLANS_DIR = ".sisyphus/plans"
const PROMETHEUS_PLAN_DIRS = [PROMETHEUS_PLANS_DIR, LEGACY_PROMETHEUS_PLANS_DIR] as const

export function findPrometheusPlans(directory: string): string[] {
  try {
    return PROMETHEUS_PLAN_DIRS.flatMap((planDir) => {
      const plansDir = join(directory, planDir)
      if (!existsSync(plansDir)) {
        return []
      }

      return readdirSync(plansDir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => join(plansDir, file))
    })
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  } catch {
    return []
  }
}

export function getPlanName(planPath: string): string {
  return basename(planPath, ".md")
}

export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: false }
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    const checklist = parsePlanChecklist(content)
    return {
      total: checklist.total,
      completed: checklist.completed,
      isComplete: checklist.total > 0 && checklist.remaining === 0,
    }
  } catch {
    return { total: 0, completed: 0, isComplete: false }
  }
}
