import { describe, it, expect, mock } from "bun:test"

mock.module("./cli-runner", () => ({
  initializeCommentCheckerCli: () => {},
  getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
  isCliPathUsable: () => true,
  processWithCli: async () => {},
  processApplyPatchEditsWithCli: async () => {},
}))

const { createCommentCheckerHooks } = await import("./hook")

describe("comment-checker null output guard", () => {
  it("does not throw when output.output is undefined", async () => {
    const hooks = createCommentCheckerHooks()
    const input = { tool: "Edit", sessionID: "ses_test", callID: "call_test" }
    const output = { title: "Edit", output: undefined as unknown as string, metadata: {} }

    await hooks["tool.execute.after"](input, output)

    expect(output.output).toBeUndefined()
  })

  it("does not throw when output.output is null", async () => {
    const hooks = createCommentCheckerHooks()
    const input = { tool: "Edit", sessionID: "ses_test", callID: "call_test" }
    const output = { title: "Edit", output: null as unknown as string, metadata: {} }

    await hooks["tool.execute.after"](input, output)

    expect(output.output).toBeNull()
  })

  it("still processes valid string output", async () => {
    const hooks = createCommentCheckerHooks()
    const input = { tool: "Edit", sessionID: "ses_test", callID: "call_test" }
    const output = { title: "Edit", output: "File edited successfully", metadata: {} }

    await hooks["tool.execute.after"](input, output)

    expect(typeof output.output).toBe("string")
  })

  it("skips tool failure output without crashing", async () => {
    const hooks = createCommentCheckerHooks()
    const input = { tool: "Edit", sessionID: "ses_test", callID: "call_test" }
    const output = { title: "Edit", output: "Error: something went wrong", metadata: {} }

    await hooks["tool.execute.after"](input, output)

    expect(output.output).toBe("Error: something went wrong")
  })
})
