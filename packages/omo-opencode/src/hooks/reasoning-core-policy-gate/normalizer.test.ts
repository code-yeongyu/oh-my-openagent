import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeCandidateAction } from "./normalizer"

describe("normalizeCandidateAction", () => {
  it("normalizes the basic candidate shape", () => {
    const candidate = normalizeCandidateAction("task", "session-1", { prompt: "hello" })

    assert.deepEqual(candidate, {
      tool: "task",
      sessionID: "session-1",
      args: { prompt: "hello" },
    })
  })

  it("preserves the agent key when provided", () => {
    const candidate = normalizeCandidateAction("write", "session-2", { path: "a.md" }, "prometheus")

    assert.equal(candidate.agent, "prometheus")
  })

  it("maps args.subagent_type to context.subagentType", () => {
    const candidate = normalizeCandidateAction(
      "task",
      "session-3",
      { subagent_type: "metis", prompt: "plan" },
      "prometheus",
    )

    assert.deepEqual(candidate.context, { subagentType: "metis" })
  })
})
