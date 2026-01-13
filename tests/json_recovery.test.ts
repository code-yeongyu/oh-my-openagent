
import { describe, it, expect } from "vitest"
import { createJsonErrorRecoveryHook, JSON_ERROR_REMINDER } from "../src/hooks/json-error-recovery"

// Test context mock
const mockCtx: any = {
  client: {},
  directory: "/tmp",
}

describe("JSON Error Recovery Hook", () => {
  it("should inject reminder when json parse error occurs", async () => {
    const hook = createJsonErrorRecoveryHook(mockCtx)
    const output = {
      title: "Tool Error",
      output: "JSON Parse error: Expected '}'",
      metadata: {},
    }
    
    await hook["tool.execute.after"](
      { tool: "AnyTool", sessionID: "test", callID: "call_1" },
      output
    )
    
    expect(output.output).toContain(JSON_ERROR_REMINDER)
  })

  it("should inject reminder for SyntaxError", async () => {
    const hook = createJsonErrorRecoveryHook(mockCtx)
    const output = {
      title: "Tool Error",
      output: "SyntaxError: Unexpected token",
      metadata: {},
    }
    
    await hook["tool.execute.after"](
      { tool: "AnyTool", sessionID: "test", callID: "call_1" },
      output
    )
    
    expect(output.output).toContain(JSON_ERROR_REMINDER)
  })

  it("should not inject reminder for normal output", async () => {
    const hook = createJsonErrorRecoveryHook(mockCtx)
    const output = {
      title: "Success",
      output: "Task completed successfully",
      metadata: {},
    }
    
    await hook["tool.execute.after"](
      { tool: "AnyTool", sessionID: "test", callID: "call_1" },
      output
    )
    
    expect(output.output).not.toContain(JSON_ERROR_REMINDER)
  })
})
