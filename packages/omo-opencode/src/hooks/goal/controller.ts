import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { clearGoal, createGoal, readGoal, updateGoal } from "./store"
import type { Goal, GoalStatus, GoalUpdate, TokenUsageSnapshot } from "./types"
import { validateObjective } from "./validation"

export type GoalControllerOptions = {
  readonly projectDir: string
}

export type GoalLink = {
  readonly parentGoalID?: string
  readonly maxIterations?: number
  readonly rootGoalID?: string
}

export type TuiLoopSnapshot = {
  readonly version: 1
  readonly activeGoalId: string | undefined
  readonly goals: readonly {
    readonly id: string
    readonly title: string
    readonly status: "in_progress" | "complete"
    readonly successCriteria: readonly []
  }[]
}

export type GoalController = ReturnType<typeof createGoalController>

export function createGoalController(options: GoalControllerOptions) {
  const { projectDir } = options
  const baseDir = join(projectDir, ".omo", "goal")

  const storeRef = (sessionID: string) => ({ baseDir, sessionID })
  const tuiMirrorPath = (sessionID: string) =>
    join(projectDir, ".omo", "ulw-loop", sessionID, "goals.json")

  const writeTuiMirror = (sessionID: string, goal: Goal | null): void => {
    const path = tuiMirrorPath(sessionID)
    const snapshot: TuiLoopSnapshot = {
      version: 1,
      activeGoalId: goal?.id,
      goals: goal === null
        ? []
        : [{
            id: goal.id,
            title: goal.objective,
            status: goalStatusForTui(goal.status),
            successCriteria: [],
          }],
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8")
  }

  return {
    setGoal(sessionID: string, rawObjective: string, link?: GoalLink): Goal {
      const objective =
        typeof rawObjective === "string" ? validateObjective(rawObjective) : validateObjective("")
      const ref = storeRef(sessionID)
      clearGoal(ref)
      let goal = createGoal(ref, objective)
      if (link?.maxIterations !== undefined) {
        const withBudget = updateGoal(ref, { maxIterations: link.maxIterations })
        if (withBudget !== null) goal = withBudget
      }
      if (link && (link.parentGoalID !== undefined || link.rootGoalID !== undefined)) {
        const updated = updateGoal(ref, {
          ...(link.parentGoalID !== undefined ? { parentGoalID: link.parentGoalID } : {}),
          ...(link.rootGoalID !== undefined ? { rootGoalID: link.rootGoalID } : {}),
        })
        if (updated !== null) goal = updated
      }
      writeTuiMirror(sessionID, goal)
      return goal
    },
    getGoal(sessionID: string): Goal | null {
      return readGoal(storeRef(sessionID))
    },
    addChildSession(sessionID: string, childSessionID: string): Goal | null {
      const ref = storeRef(sessionID)
      const existing = readGoal(ref)
      if (existing === null) return null
      if (existing.childSessionIDs.includes(childSessionID)) return existing
      const updated = updateGoal(ref, { childSessionIDs: [...existing.childSessionIDs, childSessionID] } as GoalUpdate & { readonly childSessionIDs: readonly string[] })
      if (updated) writeTuiMirror(sessionID, updated)
      return updated
    },
    updateProgress(sessionID: string, update: GoalUpdate): Goal | null {
      const goal = updateGoal(storeRef(sessionID), update)
      if (goal !== null) writeTuiMirror(sessionID, goal)
      return goal
    },

    pauseGoal(sessionID: string): Goal | null {
      const goal = updateGoal(storeRef(sessionID), { status: "paused" })
      if (goal !== null) writeTuiMirror(sessionID, goal)
      return goal
    },

    resumeGoal(sessionID: string): Goal | null {
      const goal = updateGoal(storeRef(sessionID), { status: "active" })
      if (goal !== null) writeTuiMirror(sessionID, goal)
      return goal
    },

    clearGoal(sessionID: string): boolean {
      const ref = storeRef(sessionID)
      const existed = readGoal(ref) !== null
      clearGoal(ref)
      writeTuiMirror(sessionID, null)
      return existed
    },

    markComplete(sessionID: string): Goal | null {
      const goal = updateGoal(storeRef(sessionID), { status: "complete" })
      if (goal !== null) writeTuiMirror(sessionID, goal)
      return goal
    },

    accountUsage(sessionID: string, usage: TokenUsageSnapshot, elapsedSeconds: number): Goal | null {
      const ref = storeRef(sessionID)
      const goal = readGoal(ref)
      if (goal === null || goal.status !== "active") {
        return goal
      }
      const tokenDelta = Math.max(0, usage.input) + Math.max(0, usage.output)
      const updated = updateGoal(ref, {
        tokensUsed: goal.tokensUsed + tokenDelta,
        timeUsedSeconds: goal.timeUsedSeconds + Math.max(0, elapsedSeconds),
      })
      if (updated !== null) writeTuiMirror(sessionID, updated)
      return updated
    },

    updateTui(sessionID: string): void {
      writeTuiMirror(sessionID, readGoal(storeRef(sessionID)))
    },
  }
}

export function goalStatusForTui(status: GoalStatus): "in_progress" | "complete" {
  return status === "complete" ? "complete" : "in_progress"
}
