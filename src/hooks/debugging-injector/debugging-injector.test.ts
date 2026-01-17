/**
 * Debugging Injector Hook Tests
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { createDebugInjectorHook } from "./index"

describe("Debugging Injector Hook", () => {
  describe("Configuration", () => {
    test("should not be active when disabled", async () => {
      // #given - a disabled hook
      const hook = createDebugInjectorHook(
        { cwd: "/test" },
        { config: { enabled: false } }
      )
      const input = { tool: "lsp_diagnostics", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: something failed" }

      // #when - hook is called multiple times
      await hook["tool.execute.after"](input, output)
      await hook["tool.execute.after"](input, output)
      await hook["tool.execute.after"](input, output)

      // #then - should not inject skill
      expect(output.messages).toBeUndefined()
    })
  })

  describe("Failure Tracking", () => {
    let hook: ReturnType<typeof createDebugInjectorHook>

    beforeEach(() => {
      hook = createDebugInjectorHook(
        { cwd: "/test" },
        { config: { enabled: true, failure_threshold: 2 } }
      )
    })

    test("should track edit attempts", async () => {
      // #given - an edit tool call
      const editInput = { tool: "edit", sessionID: "test", callID: "1" }
      const editOutput: {
        args: Record<string, unknown>
        blocked?: boolean
      } = { args: { filePath: "src/utils/helper.ts", newString: "new code" } }

      // #when - hook is called before tool execution
      await hook["tool.execute.before"](editInput, editOutput)

      // #then - should not block
      expect(editOutput.blocked).toBeUndefined()
    })

    test("should detect failure patterns in output", async () => {
      // #given - an edit followed by a failed verification
      const editInput = { tool: "edit", sessionID: "test", callID: "1" }
      const editOutput: { args: Record<string, unknown> } = {
        args: { filePath: "src/utils/helper.ts", newString: "new code" },
      }
      await hook["tool.execute.before"](editInput, editOutput)

      const verifyInput = { tool: "lsp_diagnostics", sessionID: "test", callID: "2" }
      const verifyOutput: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: Type 'string' is not assignable to type 'number'" }

      // #when - verification fails once
      await hook["tool.execute.after"](verifyInput, verifyOutput)

      // #then - should not inject skill yet (below threshold)
      expect(verifyOutput.messages).toBeUndefined()
    })

    test("should inject debugging skill after threshold failures", async () => {
      // #given - an edit tool call
      const editInput = { tool: "edit", sessionID: "test", callID: "1" }
      const editOutput: { args: Record<string, unknown> } = {
        args: { filePath: "src/utils/helper.ts", newString: "new code" },
      }
      await hook["tool.execute.before"](editInput, editOutput)

      const verifyInput = { tool: "lsp_diagnostics", sessionID: "test", callID: "2" }

      // #when - verification fails twice (reaching threshold)
      const output1: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: first failure" }
      await hook["tool.execute.after"](verifyInput, output1)

      const output2: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: second failure" }
      await hook["tool.execute.after"](verifyInput, output2)

      // #then - should inject debugging skill
      expect(output2.messages).toBeDefined()
      expect(output2.messages?.length).toBeGreaterThan(0)
      expect(output2.messages?.[0].content).toContain("DEBUGGING SKILL")
      expect(output2.messages?.[0].content).toContain("systematic debugging")
    })

    test("should only inject skill once per file", async () => {
      // #given - an edit tool call
      const editInput = { tool: "edit", sessionID: "test", callID: "1" }
      const editOutput: { args: Record<string, unknown> } = {
        args: { filePath: "src/utils/helper.ts", newString: "new code" },
      }
      await hook["tool.execute.before"](editInput, editOutput)

      const verifyInput = { tool: "lsp_diagnostics", sessionID: "test", callID: "2" }

      // #when - verification fails multiple times
      const output1: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: first failure" }
      await hook["tool.execute.after"](verifyInput, output1)

      const output2: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: second failure" }
      await hook["tool.execute.after"](verifyInput, output2)

      const output3: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: third failure" }
      await hook["tool.execute.after"](verifyInput, output3)

      // #then - should inject skill only on second failure
      expect(output2.messages?.length).toBeGreaterThan(0)
      expect(output3.messages).toBeUndefined()
    })

    test("should reset failure count on success", async () => {
      // #given - a hook with reset_on_success enabled
      const resetHook = createDebugInjectorHook(
        { cwd: "/test" },
        { config: { enabled: true, failure_threshold: 2, reset_on_success: true } }
      )

      const editInput = { tool: "edit", sessionID: "test", callID: "1" }
      const editOutput: { args: Record<string, unknown> } = {
        args: { filePath: "src/utils/helper.ts", newString: "new code" },
      }
      await resetHook["tool.execute.before"](editInput, editOutput)

      const verifyInput = { tool: "lsp_diagnostics", sessionID: "test", callID: "2" }

      // First failure
      const output1: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: first failure" }
      await resetHook["tool.execute.after"](verifyInput, output1)

      // Success - should reset
      const successOutput: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "No errors found" }
      await resetHook["tool.execute.after"](verifyInput, successOutput)

      // #when - another failure after reset
      const output2: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: new failure" }
      await resetHook["tool.execute.after"](verifyInput, output2)

      // #then - should not inject skill (count was reset)
      expect(output2.messages).toBeUndefined()
    })
  })

  describe("Multiple Files", () => {
    test("should track failures separately per file", async () => {
      // #given - a hook
      const hook = createDebugInjectorHook(
        { cwd: "/test" },
        { config: { enabled: true, failure_threshold: 2 } }
      )

      const verifyInput = { tool: "lsp_diagnostics", sessionID: "test", callID: "2" }

      // Failure on file A
      const editInputA = { tool: "edit", sessionID: "test", callID: "1" }
      const editOutputA: { args: Record<string, unknown> } = {
        args: { filePath: "src/fileA.ts", newString: "code" },
      }
      await hook["tool.execute.before"](editInputA, editOutputA)

      const outputA1: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: failure A" }
      await hook["tool.execute.after"](verifyInput, outputA1)

      // Failure on file B
      const editInputB = { tool: "edit", sessionID: "test", callID: "3" }
      const editOutputB: { args: Record<string, unknown> } = {
        args: { filePath: "src/fileB.ts", newString: "code" },
      }
      await hook["tool.execute.before"](editInputB, editOutputB)

      const outputB1: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: failure B" }
      await hook["tool.execute.after"](verifyInput, outputB1)

      // #when - second failure on file B
      const outputB2: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "error: another failure B" }
      await hook["tool.execute.after"](verifyInput, outputB2)

      // #then - should inject for file B (2 failures) but not file A (1 failure)
      expect(outputB2.messages?.length).toBeGreaterThan(0)
      expect(outputB2.messages?.[0].content).toContain("fileB.ts")
    })
  })

  describe("Verification Tools", () => {
    test("should detect failures from bash tool", async () => {
      // #given - a hook
      const hook = createDebugInjectorHook(
        { cwd: "/test" },
        { config: { enabled: true, failure_threshold: 2 } }
      )

      const editInput = { tool: "edit", sessionID: "test", callID: "1" }
      const editOutput: { args: Record<string, unknown> } = {
        args: { filePath: "src/utils/helper.ts", newString: "code" },
      }
      await hook["tool.execute.before"](editInput, editOutput)

      const bashInput = { tool: "bash", sessionID: "test", callID: "2" }

      // #when - bash fails twice
      const output1: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "npm ERR! test failed" }
      await hook["tool.execute.after"](bashInput, output1)

      const output2: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: {}, content: "Error: Cannot find module" }
      await hook["tool.execute.after"](bashInput, output2)

      // #then - should inject debugging skill
      expect(output2.messages?.length).toBeGreaterThan(0)
      expect(output2.messages?.[0].content).toContain("DEBUGGING SKILL")
    })
  })
})
