import { parseCodexGoalSnapshot, type CodexGoalSnapshotStatus } from "../../../../../omo-codex/plugin/components/ulw-loop/src/codex-goal-snapshot.js"
import { acknowledgedDriverObjectives, normalizeDriverObjective } from "../../../../../omo-codex/plugin/components/ulw-loop/src/driver-objective-ack.js"
import { codexGoalMode, compatibleCodexObjectives } from "../../../../../omo-codex/plugin/components/ulw-loop/src/goal-status.js"
import type { UlwLoopPlan } from "../../../../../omo-codex/plugin/components/ulw-loop/src/types.js"
import { readDriverGoalJson } from "./driver-goal"

export type SessionDriverRelation =
  | { readonly available: false }
  | {
      readonly available: true
      readonly status: CodexGoalSnapshotStatus
      readonly objectiveMatchesPlan: boolean
      readonly objectiveAcknowledged: boolean
    }

function expectedObjectives(plan: UlwLoopPlan): ReadonlySet<string> {
  const active = plan.goals.find(goal => goal.id === plan.activeGoalId)
  const candidates = codexGoalMode(plan) === "aggregate" ? compatibleCodexObjectives(plan) : active === undefined ? [] : [active.objective]
  return new Set(candidates.map(normalizeDriverObjective).filter(Boolean))
}

export function driverRelationOf(plan: UlwLoopPlan, goalStorePaths: readonly string[], warnings: string[]): SessionDriverRelation {
  const derived = readDriverGoalJson(goalStorePaths)
  warnings.push(...derived.warnings)
  if (derived.codexGoalJson === undefined) return { available: false }
  const snapshot = parseCodexGoalSnapshot(JSON.parse(derived.codexGoalJson))
  if (!snapshot.available) return { available: false }
  const actual = normalizeDriverObjective(snapshot.objective ?? "")
  return {
    available: true,
    status: snapshot.status ?? "unknown",
    objectiveMatchesPlan: actual === "" || expectedObjectives(plan).has(actual),
    objectiveAcknowledged: acknowledgedDriverObjectives(plan).includes(actual),
  }
}
