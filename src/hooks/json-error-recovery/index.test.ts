import { beforeEach, describe, expect, it } from "bun:test"

import {
  createJsonErrorRecoveryHook,
  JSON_ERROR_PATTERNS,
  JSON_ERROR_REMINDER,
} from "./index"

describe("createJsonErrorRecoveryHook", () => {
  let hook: ReturnType<typeof createJsonErrorRecoveryHook>

  beforeEach(() => {
    hook = createJsonErrorRecoveryHook({} as any)
  })

  describe("tool.execute.after", () => {
    const createInput = () => ({
      tool: "Read",
      sessionID: "test-session",
      callID: "test-call-id",
    })

    const createOutput = (outputText: string) => ({
      title: "Tool Error",
      output: outputText,
      metadata: {},
    })

    it("appends reminder when output includes JSON parse error", async () => {
      const input = createInput()
      const output = createOutput("JSON Parse error: Expected '}'")

      await hook["tool.execute.after"](input, output)

      expect(output.output).toContain(JSON_ERROR_REMINDER)
    })

    it("appends reminder when output includes SyntaxError", async () => {
      const input = createInput()
      const output = createOutput("SyntaxError: Unexpected token in JSON at position 10")

      await hook["tool.execute.after"](input, output)

      expect(output.output).toContain(JSON_ERROR_REMINDER)
    })

    it("does not append reminder for normal output", async () => {
      const input = createInput()
      const output = createOutput("Task completed successfully")

      await hook["tool.execute.after"](input, output)

      expect(output.output).toBe("Task completed successfully")
    })
  })

  describe("JSON_ERROR_PATTERNS", () => {
    it("contains known parse error patterns", () => {
      expect(JSON_ERROR_PATTERNS).toContain("json parse error")
      expect(JSON_ERROR_PATTERNS).toContain("syntaxerror: unexpected token")
      expect(JSON_ERROR_PATTERNS).toContain("expected '}'")
      expect(JSON_ERROR_PATTERNS).toContain("unexpected eof")
    })
  })
})
