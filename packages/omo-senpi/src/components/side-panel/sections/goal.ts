import { bar } from "../format/bars"
import { truncateVisible } from "../format/truncate"
import { compactTokens, duration } from "../format/units"
import type { PanelGoal, PanelGoalStatus, PanelRow } from "../types"
import { barWidth, field, heading } from "./layout"

/** The status carries the colour, so a glance at the heading already says whether to worry. */
const STATUS_COLOR: Readonly<Record<PanelGoalStatus, PanelRow["color"]>> = {
  active: "accent",
  paused: "muted",
  blocked: "warning",
  budgetLimited: "warning",
  complete: "success",
}

/**
 * The wording is the host's own (`goalStatusLabel` in pi-goal): the footer and this column describe
 * one goal on one screen, and two names for one state would read as two different goals.
 */
const STATUS_LABEL: Readonly<Record<PanelGoalStatus, string>> = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  budgetLimited: "limited by budget",
  complete: "complete",
}

/**
 * The registered goal: what the session is pursuing, how far in, and at what cost.
 *
 * Elapsed and spend come from the store's own accounting rather than from a local clock, so the
 * column cannot drift away from the number the host reports. Rows that would only ever say "zero"
 * are left out entirely - a budget nobody set and a loop that never continued are not news.
 */
export function buildGoalRows(goal: PanelGoal | undefined, width: number): readonly PanelRow[] {
  if (width <= 0 || goal === undefined) return []
  const elapsed = goal.timeUsedSeconds > 0 ? ` · ${duration(goal.timeUsedSeconds * 1_000)}` : ""
  const rows: PanelRow[] = [
    { ...heading("GOAL", `${STATUS_LABEL[goal.status]}${elapsed}`), color: STATUS_COLOR[goal.status] },
  ]
  // The objective is the content, not a labelled field, and it is a handle: objectives run to
  // kilobytes, so the row shows the head and a click opens the whole thing.
  rows.push({ text: truncateVisible(goal.objective, width), color: "text", action: { kind: "goal" } })
  if (goal.tokensUsed > 0) rows.push(field("tokens", compactTokens(goal.tokensUsed), "muted"))
  const budget = goal.tokenBudget
  if (budget !== undefined && budget > 0) {
    const percent = (goal.tokensUsed / budget) * 100
    const tail = 5
    const rendered = bar(percent / 100, barWidth(width, tail))
    if (rendered !== "") rows.push(field("budget", `${rendered} ${Math.round(percent)}%`, "accent"))
  }
  if (goal.consecutiveContinuations > 0 || goal.unattendedContinuations > 0) {
    const loops = `${goal.consecutiveContinuations} · ${goal.unattendedContinuations} unattended`
    rows.push(field("loops", loops, "muted"))
  }
  return rows
}
