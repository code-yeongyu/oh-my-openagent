import { describe, it, expect, beforeEach } from "bun:test"
import { HOOK_NAME, REMINDER_MESSAGE, TOOLS_REQUIRING_DIAGNOSTICS, DIAGNOSTICS_TOOL } from "./constants"

describe("lsp-diagnostics-enforcer constants", () => {
  // #given constants are exported
  // #when accessing constant values
  // #then they should have expected values

  it("should export correct hook name", () => {
    expect(HOOK_NAME).toBe("lsp-diagnostics-enforcer")
  })

  it("should export reminder message with required content", () => {
    expect(REMINDER_MESSAGE).toContain("LSP Diagnostics Required")
    expect(REMINDER_MESSAGE).toContain("lsp_diagnostics")
    expect(REMINDER_MESSAGE).toContain("ZERO errors")
  })

  it("should include Edit and Write in tools requiring diagnostics", () => {
    expect(TOOLS_REQUIRING_DIAGNOSTICS).toContain("Edit")
    expect(TOOLS_REQUIRING_DIAGNOSTICS).toContain("Write")
    expect(TOOLS_REQUIRING_DIAGNOSTICS).toContain("MultiEdit")
  })

  it("should define diagnostics tool name", () => {
    expect(DIAGNOSTICS_TOOL).toBe("lsp_diagnostics")
  })
})

describe("lsp-diagnostics-enforcer hook behavior", () => {
  // #given a mock plugin context
  // #when the hook processes tool events
  // #then it should track file modifications and inject reminders

  it("should track modified files after Edit tool", async () => {
    const { createLspDiagnosticsEnforcerHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createLspDiagnosticsEnforcerHook(mockCtx)
    
    const input = {
      sessionID: "test-session",
      tool: "Edit",
      args: { filePath: "/test/file.ts" }
    }
    const output = { result: "success", output: "" }
    
    await hook["tool.execute.after"](input, output)
    
    // Hook should not inject reminder yet (no todowrite with completed)
    expect(output.output).toBe("")
  })

  it("should inject reminder when todowrite marks complete without diagnostics", async () => {
    const { createLspDiagnosticsEnforcerHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createLspDiagnosticsEnforcerHook(mockCtx)
    
    // First, simulate a file edit
    await hook["tool.execute.after"](
      { sessionID: "test-session-2", tool: "Edit", args: { filePath: "/test/file.ts" } },
      { result: "success", output: "" }
    )
    
    // Then, simulate todowrite with completed task
    const todoOutput = { result: "success", output: "" }
    await hook["tool.execute.after"](
      { 
        sessionID: "test-session-2", 
        tool: "todowrite", 
        args: { todos: [{ status: "completed" }] } 
      },
      todoOutput
    )
    
    // Should inject reminder
    expect(todoOutput.output).toContain("LSP Diagnostics Required")
  })

  it("should NOT inject reminder if diagnostics passed", async () => {
    const { createLspDiagnosticsEnforcerHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createLspDiagnosticsEnforcerHook(mockCtx)
    
    // Simulate file edit
    await hook["tool.execute.after"](
      { sessionID: "test-session-3", tool: "Edit", args: { filePath: "/test/file.ts" } },
      { result: "success", output: "" }
    )
    
    // Simulate lsp_diagnostics with no errors
    await hook["tool.execute.after"](
      { sessionID: "test-session-3", tool: "lsp_diagnostics", args: {} },
      { result: "0 errors found", output: "" }
    )
    
    // Then todowrite
    const todoOutput = { result: "success", output: "" }
    await hook["tool.execute.after"](
      { 
        sessionID: "test-session-3", 
        tool: "todowrite", 
        args: { todos: [{ status: "completed" }] } 
      },
      todoOutput
    )
    
    // Should NOT inject reminder (diagnostics passed)
    expect(todoOutput.output).not.toContain("LSP Diagnostics Required")
  })
})
