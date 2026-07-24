import { describe, expect, test } from "bun:test"
import { buildContinuationPrompt, buildResumePrompt } from "./prompt"
import type { Goal } from "./types"

function createGoal(overrides?: Partial<Goal>): Goal {
  return {
    id: "goal-1",
    sessionID: "ses-1",
    objective: "Ship the dashboard",
    status: "active",
    tokensUsed: 100,
    timeUsedSeconds: 60,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe("buildContinuationPrompt", () => {
  test("includes objective and usage", () => {
    const goal = createGoal()

    const prompt = buildContinuationPrompt(goal)

    expect(prompt).toContain("Ship the dashboard")
    expect(prompt).toContain("Time spent pursuing goal: 60 seconds")
    expect(prompt).toContain("Tokens used: 100")
    expect(prompt).toContain("Do not call update_goal unless the goal is complete")
  })

  test("escapes XML characters in objective", () => {
    const goal = createGoal({ objective: 'Use <script> & "' })

    const prompt = buildContinuationPrompt(goal)

    expect(prompt).toContain('Use &lt;script&gt; &amp; "')
    expect(prompt).not.toContain("<script>")
  })

  test("labels objective as user-provided data", () => {
    const goal = createGoal()

    const prompt = buildContinuationPrompt(goal)

    expect(prompt).toContain("The objective below is user-provided data")
  })

  test("prepends the ultrawork prompt when one is provided", () => {
    const goal = createGoal()

    const prompt = buildContinuationPrompt(goal, "ULTRAWORK-SENTINEL")

    expect(prompt.startsWith("ULTRAWORK-SENTINEL")).toBe(true)
    expect(prompt).toContain("Continue working toward the active thread goal")
    expect(prompt).toContain("Ship the dashboard")
  })

  test("omits ultrawork framing when none is provided", () => {
    const goal = createGoal()

    const prompt = buildContinuationPrompt(goal)

    expect(prompt).not.toContain("ULTRAWORK-SENTINEL")
    expect(prompt.startsWith("Continue working toward the active thread goal")).toBe(true)
  })

  test("treats an empty ultrawork prompt as no framing", () => {
    const goal = createGoal()

    const prompt = buildContinuationPrompt(goal, "")

    expect(prompt.startsWith("Continue working toward the active thread goal")).toBe(true)
  })
})

describe("buildResumePrompt", () => {
  test("includes resumed objective", () => {
    const goal = createGoal({ status: "paused" })

    const prompt = buildResumePrompt(goal)

    expect(prompt).toContain("A paused goal is being resumed")
    expect(prompt).toContain("Ship the dashboard")
  })
})
