import { describe, expect, test } from "bun:test"

import type { PanelGoal, PanelRow } from "../types"
import { buildGoalRows } from "./goal"

const goal = (overrides: Partial<PanelGoal> = {}): PanelGoal => ({
  objective: "Extend the side panel with the subsystems omo gained since beta.53",
  status: "active",
  tokensUsed: 148_000,
  timeUsedSeconds: 8_040,
  consecutiveContinuations: 0,
  unattendedContinuations: 0,
  ...overrides,
})

const texts = (rows: readonly PanelRow[]): string[] => rows.map((row) => row.text)

describe("buildGoalRows", () => {
  test("#given an active goal #when built #then the heading carries status and elapsed", () => {
    // given
    const rows = buildGoalRows(goal(), 40)

    // then the folded read already answers \"is it running, and how long\"
    expect(rows[0]?.text.startsWith("GOAL  active")).toBe(true)
    expect(rows[0]?.text.length).toBeGreaterThan("GOAL  active".length)
  })

  test("#given a long objective #when built #then it is cut to the column and stays clickable", () => {
    // given objectives run to kilobytes, so the row is a handle, not the text
    const rows = buildGoalRows(goal(), 30)
    const objective = rows[1]

    // then
    expect(objective?.text.length).toBeLessThanOrEqual(30)
    expect(objective?.action).toEqual({ kind: "goal" })
  })

  test("#given tokens spent #when built #then the goal's own total is shown", () => {
    // given the session block counts this turn; the goal counts the whole pursuit
    expect(texts(buildGoalRows(goal(), 40)).some((t) => t.startsWith("tokens") && t.includes("148"))).toBe(true)
  })

  test("#given a token budget #when built #then a bar shows how much of it is gone", () => {
    // given
    const rows = buildGoalRows(goal({ tokenBudget: 300_000 }), 44)

    // then
    const budget = rows.find((row) => row.text.startsWith("budget"))
    expect(budget?.text).toContain("49%")
  })

  test("#given no token budget #when built #then no budget row is invented", () => {
    // given / when / then
    expect(buildGoalRows(goal(), 40).some((row) => row.text.startsWith("budget"))).toBe(false)
  })

  test("#given the loop continued on its own #when built #then that is called out", () => {
    // given unattended continuations are the part worth noticing
    const rows = buildGoalRows(goal({ consecutiveContinuations: 6, unattendedContinuations: 4 }), 40)
    const loops = rows.find((row) => row.text.startsWith("loops"))

    // then
    expect(loops?.text).toContain("6")
    expect(loops?.text).toContain("4")
  })

  test("#given a goal that never continued #when built #then no loops row appears", () => {
    // given zero is not news
    expect(buildGoalRows(goal(), 40).some((row) => row.text.startsWith("loops"))).toBe(false)
  })

  test("#given a blocked goal #when built #then the heading reads as a warning", () => {
    // given
    const rows = buildGoalRows(goal({ status: "blocked" }), 40)

    // then
    expect(rows[0]?.color).toBe("warning")
  })

  test("#given no goal #when built #then the section is absent, not an empty heading", () => {
    // given / when / then
    expect(buildGoalRows(undefined, 40)).toEqual([])
  })
})

describe("goal status heading", () => {
  test("#given a goal stopped by its token budget #when the heading is drawn #then it says so in the host's own words", () => {
    // given the host names this state "limited by budget" (`pi-goal/src/goal/format.ts`), and a
    // column that invented its own wording would disagree with the footer on the same screen
    const rows = buildGoalRows(goal({ status: "budgetLimited" }), 52)

    // then
    expect(rows[0]?.text).toContain("limited by budget")
    expect(rows[0]?.color).toBe("warning")
  })

  test("#given a paused goal #when the heading is drawn #then it is not painted as trouble", () => {
    // given pausing is a deliberate act, not a failure
    const rows = buildGoalRows(goal({ status: "paused" }), 52)

    // then
    expect(rows[0]?.text).toContain("paused")
    expect(rows[0]?.color).toBe("muted")
  })
})
