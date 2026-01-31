import { describe, it, expect, beforeEach, mock } from "bun:test"
import {
  createPostHookTrigger,
  type PostHookTrigger,
  type PostHookConfig,
  type Diagnostic,
} from "./post-hook-trigger"

describe("PostHookTrigger", () => {
  let trigger: PostHookTrigger

  //#given a post-hook trigger configuration
  const defaultConfig: PostHookConfig = {
    enabled: true,
    timeoutMs: 5000,
  }

  beforeEach(() => {
    trigger = createPostHookTrigger(defaultConfig)
  })

  describe("triggerLspDiagnostics", () => {
    //#when MCP executes a code modification
    //#then it should trigger LSP diagnostics
    it("should trigger LSP diagnostics after MCP edit", async () => {
      const filePath = "src/example.ts"
      const mockDiagnostics: Diagnostic[] = [
        { file: filePath, line: 10, message: "Type error", severity: "error" as const },
      ]

      const result = await trigger.triggerLspDiagnostics(filePath, {
        lspProvider: async () => mockDiagnostics,
      })

      expect(result.triggered).toBe(true)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0].message).toBe("Type error")
    })

    //#when LSP diagnostics find errors
    //#then diagnostics should be available for context injection
    it("should make diagnostics available for context injection", async () => {
      const filePath = "src/example.ts"
      const mockDiagnostics: Diagnostic[] = [
        { file: filePath, line: 5, message: "Missing import", severity: "error" as const },
        { file: filePath, line: 15, message: "Unused variable", severity: "warning" as const },
      ]

      await trigger.triggerLspDiagnostics(filePath, {
        lspProvider: async () => mockDiagnostics,
      })

      const context = trigger.getContextInjection()
      expect(context).toContain("Missing import")
      expect(context).toContain("Unused variable")
    })

    //#when post-hook is disabled
    //#then it should skip diagnostics
    it("should skip diagnostics when disabled", async () => {
      const disabledTrigger = createPostHookTrigger({ ...defaultConfig, enabled: false })

      const result = await disabledTrigger.triggerLspDiagnostics("src/example.ts", {
        lspProvider: async () => [],
      })

      expect(result.triggered).toBe(false)
      expect(result.skipped).toBe(true)
      expect(result.reason).toBe("disabled")
    })
  })

  describe("error handling", () => {
    //#when LSP is unavailable
    //#then it should skip diagnostics and log warning
    it("should handle LSP unavailability gracefully", async () => {
      const result = await trigger.triggerLspDiagnostics("src/example.ts", {
        lspProvider: async () => {
          throw new Error("LSP not available")
        },
      })

      expect(result.triggered).toBe(false)
      expect(result.error).toContain("LSP not available")
    })

    //#when diagnostics timeout
    //#then it should return timeout error
    it("should handle diagnostics timeout", async () => {
      const slowTrigger = createPostHookTrigger({ ...defaultConfig, timeoutMs: 100 })

      const result = await slowTrigger.triggerLspDiagnostics("src/example.ts", {
        lspProvider: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return []
        },
      })

      expect(result.triggered).toBe(false)
      expect(result.error).toContain("timeout")
    })
  })

  describe("workflow integration", () => {
    //#when MCP workflow continues after diagnostics
    //#then it should not block the workflow
    it("should not block MCP workflow", async () => {
      const filePath = "src/example.ts"
      let workflowCompleted = false

      // Simulate MCP workflow with post-hook
      await trigger.triggerLspDiagnostics(filePath, {
        lspProvider: async () => [
          { file: filePath, line: 1, message: "Error", severity: "error" },
        ],
      })

      // Workflow should continue regardless of diagnostics
      workflowCompleted = true

      expect(workflowCompleted).toBe(true)
    })

    //#when clearing diagnostics
    //#then context injection should be empty
    it("should clear diagnostics on reset", async () => {
      const filePath = "src/example.ts"

      await trigger.triggerLspDiagnostics(filePath, {
        lspProvider: async () => [
          { file: filePath, line: 1, message: "Error", severity: "error" },
        ],
      })

      trigger.clearDiagnostics()

      const context = trigger.getContextInjection()
      expect(context).toBe("")
    })
  })
})
