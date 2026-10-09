import { readFileSync, statSync } from "node:fs"

import { asRecord, finiteNumber, nonEmptyString, optional } from "../guards"
import type { PanelGoal, PanelGoalSource, PanelGoalStatus } from "../types"

/**
 * The session's registered goal, as the column needs to draw it.
 *
 * Two facts from the host shape this reader. senpi publishes no goal event an extension can
 * subscribe to, so the store is read on the panel's ordinary refresh rather than on a signal -
 * which is why an unchanged file must cost a `stat` and nothing more. And the store's own loader
 * carries a recovery branch for a corrupt parse, so a half-written file is a real thing to meet:
 * it answers `undefined` instead of throwing, because one missing block beats a dead frame.
 */
export function createPanelGoalReader(
  source: PanelGoalSource = nodeGoalSource,
): (path: string | undefined) => PanelGoal | undefined {
  let stamp: string | undefined
  let goal: PanelGoal | undefined
  return (path) => {
    if (path === undefined) return undefined
    const file = source.stat(path)
    if (file === undefined) {
      // Reading the path does not create it, so an absent file is the ordinary case, not an error.
      stamp = undefined
      goal = undefined
      return undefined
    }
    const current = `${path}:${file.mtimeMs}:${file.size}`
    if (current === stamp) return goal
    const parsed = parseGoal(source.read(path))
    if (parsed === undefined) {
      stamp = undefined
      goal = undefined
      return undefined
    }
    stamp = current
    goal = parsed
    return goal
  }
}

const STATUSES: readonly string[] = ["active", "paused", "blocked", "budgetLimited", "complete"]

function parseGoal(raw: string | undefined): PanelGoal | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A torn read is not a broken panel; the next refresh sees the finished file.
    return undefined
  }
  const record = asRecord(asRecord(parsed)?.["goal"])
  if (record === undefined) return undefined
  const objective = nonEmptyString(record["objective"])
  const status = record["status"]
  if (objective === undefined || !isStatus(status)) return undefined
  return {
    objective,
    status,
    tokensUsed: finiteNumber(record["tokensUsed"]) ?? 0,
    timeUsedSeconds: finiteNumber(record["timeUsedSeconds"]) ?? 0,
    consecutiveContinuations: finiteNumber(record["consecutiveContinuations"]) ?? 0,
    unattendedContinuations: finiteNumber(record["unattendedContinuations"]) ?? 0,
    ...optional("tokenBudget", finiteNumber(record["tokenBudget"])),
  }
}

function isStatus(value: unknown): value is PanelGoalStatus {
  return typeof value === "string" && STATUSES.includes(value)
}

const nodeGoalSource: PanelGoalSource = {
  stat(path) {
    try {
      const info = statSync(path)
      return { mtimeMs: info.mtimeMs, size: info.size }
    } catch {
      return undefined
    }
  },
  read(path) {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return undefined
    }
  },
}
