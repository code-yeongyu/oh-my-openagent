import { describe, it, expect, beforeEach } from "bun:test"
import { createHashlineReadEnhancerHook } from "./hook"
import type { PluginInput } from "@opencode-ai/plugin"

//#given - Test setup helpers
function createMockContext(): PluginInput {
  return {
    client: {} as unknown as PluginInput["client"],
    directory: "/test",
  }
}

interface TestConfig {
  hashline_edit?: { enabled: boolean }
}

function createMockConfig(enabled: boolean): TestConfig {
  return {
    hashline_edit: { enabled },
  }
}

describe("createHashlineReadEnhancerHook", () => {
  let mockCtx: PluginInput
  const sessionID = "test-session-123"

  beforeEach(() => {
    mockCtx = createMockContext()
  })

  describe("tool name matching", () => {
    it("should process 'read' tool (lowercase)", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: "1: hello\n2: world", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toContain("1:")
      expect(output.output).toContain("|")
    })

    it("should process 'Read' tool (mixed case)", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "Read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: "1: hello\n2: world", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toContain("|")
    })

    it("should process 'READ' tool (uppercase)", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "READ", sessionID, callID: "call-1" }
      const output = { title: "Read", output: "1: hello\n2: world", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toContain("|")
    })

    it("should skip non-read tools", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "edit", sessionID, callID: "call-1" }
      const originalOutput = "1: hello\n2: world"
      const output = { title: "Edit", output: originalOutput, metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toBe(originalOutput)
    })
  })

  describe("config flag check", () => {
    it("should skip when hashline_edit is disabled", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(false))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const originalOutput = "1: hello\n2: world"
      const output = { title: "Read", output: originalOutput, metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toBe(originalOutput)
    })

    it("should skip when hashline_edit config is missing", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, {})
      const input = { tool: "read", sessionID, callID: "call-1" }
      const originalOutput = "1: hello\n2: world"
      const output = { title: "Read", output: originalOutput, metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toBe(originalOutput)
    })
  })

  describe("output transformation", () => {
    it("should transform 'N: content' format to 'N:HASH|content'", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: "1: function hello() {\n2:   console.log('world')\n3: }", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      const lines = output.output.split("\n")
      expect(lines[0]).toMatch(/^1:[a-f0-9]{2}\|function hello\(\) \{$/)
      expect(lines[1]).toMatch(/^2:[a-f0-9]{2}\|  console\.log\('world'\)$/)
      expect(lines[2]).toMatch(/^3:[a-f0-9]{2}\|\}$/)
    })

    it("should handle empty output", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: "", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toBe("")
    })

    it("should handle single line", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: "1: const x = 1", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toMatch(/^1:[a-f0-9]{2}\|const x = 1$/)
    })
  })

  describe("binary file detection", () => {
    it("should skip binary files (no line number prefix)", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const originalOutput = "PNG\x89\x50\x4E\x47\x0D\x0A\x1A\x0A"
      const output = { title: "Read", output: originalOutput, metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toBe(originalOutput)
    })

    it("should skip if first line doesn't match pattern", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const originalOutput = "some binary data\nmore data"
      const output = { title: "Read", output: originalOutput, metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toBe(originalOutput)
    })

    it("should process if first line matches 'N: ' pattern", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: "1: valid line\n2: another line", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toContain("|")
    })
  })

  describe("edge cases", () => {
    it("should handle non-string output gracefully", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: null as unknown as string, metadata: {} }

      //#when - should not throw
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toBeNull()
    })

    it("should handle lines with no content after colon", async () => {
      //#given
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: "1: hello\n2: \n3: world", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      const lines = output.output.split("\n")
      expect(lines[0]).toMatch(/^1:[a-f0-9]{2}\|hello$/)
      expect(lines[1]).toMatch(/^2:[a-f0-9]{2}\|$/)
      expect(lines[2]).toMatch(/^3:[a-f0-9]{2}\|world$/)
    })

    it("should handle very long lines", async () => {
      //#given
      const longContent = "a".repeat(1000)
      const hook = createHashlineReadEnhancerHook(mockCtx, createMockConfig(true))
      const input = { tool: "read", sessionID, callID: "call-1" }
      const output = { title: "Read", output: `1: ${longContent}`, metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)

      //#then
      expect(output.output).toMatch(/^1:[a-f0-9]{2}\|a+$/)
    })
  })
})
