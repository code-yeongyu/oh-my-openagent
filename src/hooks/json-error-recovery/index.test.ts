import { beforeEach, describe, expect, it } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import {
  createJsonErrorRecoveryHook,
  JSON_ERROR_PATTERNS,
  JSON_ERROR_REMINDER,
  JSON_ERROR_TOOL_EXCLUDE_LIST,
} from "./index"

describe("createJsonErrorRecoveryHook", () => {
  let hook: ReturnType<typeof createJsonErrorRecoveryHook>

  type ToolExecuteAfterHandler = NonNullable<
    ReturnType<typeof createJsonErrorRecoveryHook>["tool.execute.after"]
  >
  type ToolExecuteAfterInput = Parameters<ToolExecuteAfterHandler>[0]
  type ToolExecuteAfterOutput = Parameters<ToolExecuteAfterHandler>[1]

  const createMockPluginInput = (): PluginInput => {
    return {
      client: {} as PluginInput["client"],
      directory: "/tmp/test",
    } as PluginInput
  }

  beforeEach(() => {
    hook = createJsonErrorRecoveryHook(createMockPluginInput())
  })

  describe("tool.execute.after", () => {
    const createInput = (tool = "Edit"): ToolExecuteAfterInput => ({
      tool,
      sessionID: "test-session",
      callID: "test-call-id",
    })

    const createOutput = (outputText: string): ToolExecuteAfterOutput => ({
      title: "Tool Error",
      output: outputText,
      metadata: {},
    })

    const createUnknownOutput = (value: unknown): { title: string; output: unknown; metadata: Record<string, unknown> } => ({
      title: "Tool Error",
      output: value,
      metadata: {},
    })

    it("appends reminder when output includes JSON parse error", async () => {
      // given
      const input = createInput()
      const output = createOutput("JSON parse error: expected '}' in JSON body")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toContain(JSON_ERROR_REMINDER)
    })

    it("appends reminder when output includes SyntaxError", async () => {
      // given
      const input = createInput()
      const output = createOutput("SyntaxError: Unexpected token in JSON at position 10")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toContain(JSON_ERROR_REMINDER)
    })

    it("does not append reminder for normal output", async () => {
      // given
      const input = createInput()
      const output = createOutput("Task completed successfully")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe("Task completed successfully")
    })

    it("does not append reminder for empty output", async () => {
      // given
      const input = createInput()
      const output = createOutput("")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe("")
    })

    it("does not append reminder for false positive non-JSON text", async () => {
      // given
      const input = createInput()
      const output = createOutput("Template failed: expected '}' before newline")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe("Template failed: expected '}' before newline")
    })

    it("does not append reminder for excluded tools", async () => {
      // given
      const input = createInput("Read")
      const output = createOutput("JSON parse error: unexpected end of JSON input")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe("JSON parse error: unexpected end of JSON input")
    })

    it("does not append reminder when reminder already exists", async () => {
      // given
      const input = createInput()
      const output = createOutput(`JSON parse error: invalid JSON\n${JSON_ERROR_REMINDER}`)

      // when
      await hook["tool.execute.after"](input, output)

      // then
      const reminderCount = output.output.split("[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]").length - 1
      expect(reminderCount).toBe(1)
    })

    it("does not append duplicate reminder on repeated execution", async () => {
      // given
      const input = createInput()
      const output = createOutput("JSON parse error: invalid JSON arguments")

      // when
      await hook["tool.execute.after"](input, output)
      await hook["tool.execute.after"](input, output)

      // then
      const reminderCount = output.output.split("[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]").length - 1
      expect(reminderCount).toBe(1)
    })

    it("ignores non-string output values", async () => {
      // given
      const input = createInput()
      const values: unknown[] = [42, null, undefined, { error: "invalid json" }]

      // when
      for (const value of values) {
        const output = createUnknownOutput(value)
        await hook["tool.execute.after"](input, output as ToolExecuteAfterOutput)

        // then
        expect(output.output).toBe(value)
      }
    })
  })

  describe("JSON_ERROR_PATTERNS", () => {
    it("contains known parse error patterns", () => {
      // given
      const output = "JSON parse error: unexpected end of JSON input"

      // when
      const isMatched = JSON_ERROR_PATTERNS.some((pattern) => pattern.test(output))

      // then
      expect(isMatched).toBe(true)
    })
  })

  describe("JSON_ERROR_TOOL_EXCLUDE_LIST", () => {
    it("contains content-heavy tools that should be excluded", () => {
      // given
      const expectedExcludedTools: Array<(typeof JSON_ERROR_TOOL_EXCLUDE_LIST)[number]> = [
        "read",
        "bash",
        "webfetch",
      ]

      // when
      const allExpectedToolsIncluded = expectedExcludedTools.every((toolName) =>
        JSON_ERROR_TOOL_EXCLUDE_LIST.includes(toolName)
      )

      // then
      expect(allExpectedToolsIncluded).toBe(true)
    })
  })
})
