import { describe, expect, it } from "bun:test"
import { runVerificationStages } from "./index"

describe("verification feature", () => {
  it("returns stage-by-stage verification report", async () => {
    const result = await runVerificationStages({
      taskOutput: "Implemented change in src/auth.ts and added tests",
      strictness: "medium",
    })

    expect(result.stages.length).toBe(3)
    expect(result.report).toContain("Stage 1")
    expect(result.report).toContain("Stage 2")
    expect(result.report).toContain("Stage 3")
  })

  it("fails stage 1 when task output is empty", async () => {
    const result = await runVerificationStages({ taskOutput: "" })

    expect(result.passed).toBe(false)
    expect(result.stages[0]?.passed).toBe(false)
  })
})
