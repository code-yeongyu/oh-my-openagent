import { describe, it, expect, beforeEach } from "bun:test"
import { createEditErrorRecoveryHook, EDIT_ERROR_REMINDER, EDIT_ERROR_PATTERNS } from "./index"

describe("createEditErrorRecoveryHook", () => {
  let hook: ReturnType<typeof createEditErrorRecoveryHook>

  beforeEach(() => {
    hook = createEditErrorRecoveryHook({} as any)
  })

  describe("tool.execute.after", () => {
    const createInput = (tool: string) => ({
      tool,
      sessionID: "test-session",
      callID: "test-call-id",
    })

    const createOutput = (outputText: string) => ({
      title: "Edit",
      output: outputText,
      metadata: {},
    })

    describe("#given Edit tool with oldString/newString same error", () => {
      describe("#when the error message is detected", () => {
        it("#then should append the recovery reminder", async () => {
          const input = createInput("Edit")
          const output = createOutput("Error: oldString and newString must be different")

          await hook["tool.execute.after"](input, output)

          expect(output.output).toContain(EDIT_ERROR_REMINDER)
          expect(output.output).toContain("oldString and newString must be different")
        })
      })

      describe("#when the error appears without Error prefix", () => {
        it("#then should still detect and append reminder", async () => {
          const input = createInput("Edit")
          const output = createOutput("oldString and newString must be different")

          await hook["tool.execute.after"](input, output)

          expect(output.output).toContain(EDIT_ERROR_REMINDER)
        })
      })
    })

    describe("#given Edit tool with oldString not found error", () => {
      describe("#when oldString not found in content", () => {
        it("#then should append the recovery reminder", async () => {
          const input = createInput("Edit")
          const output = createOutput("Error: oldString not found in content")

          await hook["tool.execute.after"](input, output)

          expect(output.output).toContain(EDIT_ERROR_REMINDER)
        })
      })
    })

    describe("#given Edit tool with multiple matches error", () => {
      describe("#when oldString found multiple times", () => {
        it("#then should append the recovery reminder", async () => {
          const input = createInput("Edit")
          const output = createOutput(
            "Error: oldString found multiple times and requires more code context to uniquely identify the intended match"
          )

          await hook["tool.execute.after"](input, output)

          expect(output.output).toContain(EDIT_ERROR_REMINDER)
        })
      })
    })

    describe("#given non-Edit tool", () => {
      describe("#when tool is not Edit", () => {
        it("#then should not modify output", async () => {
          const input = createInput("Read")
          const originalOutput = "some output"
          const output = createOutput(originalOutput)

          await hook["tool.execute.after"](input, output)

          expect(output.output).toBe(originalOutput)
        })
      })
    })

    describe("#given Edit tool with successful output", () => {
      describe("#when no error in output", () => {
        it("#then should not modify output", async () => {
          const input = createInput("Edit")
          const originalOutput = "File edited successfully"
          const output = createOutput(originalOutput)

          await hook["tool.execute.after"](input, output)

          expect(output.output).toBe(originalOutput)
        })
      })
    })

    describe("#given case insensitive tool name", () => {
      describe("#when tool is 'edit' lowercase", () => {
        it("#then should still detect and append reminder", async () => {
          const input = createInput("edit")
          const output = createOutput("oldString and newString must be different")

          await hook["tool.execute.after"](input, output)

          expect(output.output).toContain(EDIT_ERROR_REMINDER)
        })
      })
    })
  })

  describe("EDIT_ERROR_PATTERNS", () => {
    it("#then should contain all known Edit error patterns", () => {
      expect(EDIT_ERROR_PATTERNS).toContain("oldString and newString must be different")
      expect(EDIT_ERROR_PATTERNS).toContain("oldString not found")
      expect(EDIT_ERROR_PATTERNS).toContain("oldString found multiple times")
    })
  })
})
