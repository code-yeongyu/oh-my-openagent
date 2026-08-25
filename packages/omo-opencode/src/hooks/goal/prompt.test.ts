import { describe, expect, test } from "bun:test"
import { buildContinuationPrompt, buildResumePrompt } from "./prompt"
import type { Goal } from "./types"

function createGoal(objective: string, usage?: { timeUsedSeconds: number; tokensUsed: number }): Goal {
  return {
    id: "goal-1",
    sessionID: "ses-1",
    objective,
    status: "active",
    tokensUsed: usage?.tokensUsed ?? 100,
    timeUsedSeconds: usage?.timeUsedSeconds ?? 60,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe("buildContinuationPrompt", () => {
  test("propagates dynamic accumulated usage", () => {
    const usage = { timeUsedSeconds: 7349, tokensUsed: 982451 }
    const prompt = buildContinuationPrompt(createGoal("continuation-objective-sentinel", usage))

    expect(prompt).toContain(String(usage.timeUsedSeconds))
    expect(prompt).toContain(String(usage.tokensUsed))
  })

  test("escapes XML characters in the untrusted objective", () => {
    const prompt = buildContinuationPrompt(createGoal('Use <script> & "'))

    expect(prompt).toContain('Use &lt;script&gt; &amp; "')
    expect(prompt).not.toContain("<script>")
  })
})

describe("buildResumePrompt", () => {
  test("uses the same escaped dynamic objective payload as continuation", () => {
    const objective = "resume-objective-<sentinel>&payload>"
    const goal = createGoal(objective)
    const extractObjectivePayload = (prompt: string): string | undefined =>
      prompt.match(/<untrusted_objective>\n([\s\S]*?)\n<\/untrusted_objective>/)?.[1]

    const continuationPayload = extractObjectivePayload(buildContinuationPrompt(goal))
    const resumePayload = extractObjectivePayload(buildResumePrompt({ ...goal, status: "paused" }))

    expect(resumePayload).toBe(continuationPayload)
    expect(resumePayload).not.toBe(objective)
  })
})
