
import { describe, it, expect, vi } from "vitest"
import { createEditErrorRecoveryHook } from "../src/hooks/edit-error-recovery"
import { EDIT_ERROR_REMINDER } from "../src/hooks/edit-error-recovery"

// Mock PluginInput
const mockCtx: any = {
  client: {},
  directory: "/tmp",
}

describe("Edit Error Recovery Hook", () => {
  it("should inject reminder when edit error occurs", async () => {
    const hook = createEditErrorRecoveryHook(mockCtx)
    const output = {
      title: "Edit",
      output: "Error: oldString not found in content",
      metadata: {},
    }
    
    await hook["tool.execute.after"](
      { tool: "Edit", sessionID: "test", callID: "call_1" },
      output
    )
    
    expect(output.output).toContain(EDIT_ERROR_REMINDER)
  })

  it("should not inject reminder for successful edits", async () => {
    const hook = createEditErrorRecoveryHook(mockCtx)
    const output = {
      title: "Edit",
      output: "Successfully edited file",
      metadata: {},
    }
    
    await hook["tool.execute.after"](
      { tool: "Edit", sessionID: "test", callID: "call_1" },
      output
    )
    
    expect(output.output).not.toContain(EDIT_ERROR_REMINDER)
  })
})
