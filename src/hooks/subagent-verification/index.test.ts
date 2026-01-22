import { describe, it, expect } from "bun:test"
import { HOOK_NAME, VERIFICATION_REMINDER, DELEGATE_TASK_TOOL } from "./constants"

describe("subagent-verification constants", () => {
  // #given constants are exported
  // #when accessing constant values
  // #then they should have expected values

  it("should export correct hook name", () => {
    expect(HOOK_NAME).toBe("subagent-verification")
  })

  it("should export verification reminder with required content", () => {
    expect(VERIFICATION_REMINDER).toContain("SUBAGENT VERIFICATION REQUIRED")
    expect(VERIFICATION_REMINDER).toContain("SUBAGENTS LIE")
    expect(VERIFICATION_REMINDER).toContain("lsp_diagnostics")
    expect(VERIFICATION_REMINDER).toContain("bun run build")
  })

  it("should define delegate task tool name", () => {
    expect(DELEGATE_TASK_TOOL).toBe("delegate_task")
  })
})

describe("subagent-verification hook behavior", () => {
  // #given a mock plugin context
  // #when delegate_task completes
  // #then it should inject verification reminder

  it("should inject reminder after successful delegate_task", async () => {
    const { createSubagentVerificationHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createSubagentVerificationHook(mockCtx)
    
    const output = { result: "Task completed successfully", output: "" }
    await hook["tool.execute.after"](
      { sessionID: "test-session", tool: "delegate_task", args: {} },
      output
    )
    
    expect(output.output).toContain("SUBAGENT VERIFICATION REQUIRED")
  })

  it("should NOT inject reminder for background tasks", async () => {
    const { createSubagentVerificationHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createSubagentVerificationHook(mockCtx)
    
    const output = { result: "Task started in background", output: "" }
    await hook["tool.execute.after"](
      { sessionID: "test-session", tool: "delegate_task", args: { run_in_background: true } },
      output
    )
    
    expect(output.output).not.toContain("SUBAGENT VERIFICATION REQUIRED")
  })

  it("should NOT inject reminder for failed tasks", async () => {
    const { createSubagentVerificationHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createSubagentVerificationHook(mockCtx)
    
    const output = { result: "Task failed with error", output: "" }
    await hook["tool.execute.after"](
      { sessionID: "test-session", tool: "delegate_task", args: {} },
      output
    )
    
    expect(output.output).not.toContain("SUBAGENT VERIFICATION REQUIRED")
  })

  it("should NOT inject reminder for other tools", async () => {
    const { createSubagentVerificationHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createSubagentVerificationHook(mockCtx)
    
    const output = { result: "success", output: "" }
    await hook["tool.execute.after"](
      { sessionID: "test-session", tool: "Read", args: {} },
      output
    )
    
    expect(output.output).toBe("")
  })
})
