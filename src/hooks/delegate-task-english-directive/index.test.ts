import { describe, expect, it } from "bun:test"

import { createDelegateTaskEnglishDirectiveHook, ENGLISH_DIRECTIVE, TARGET_SUBAGENT_TYPES } from "./index"

describe("delegate-task-english-directive", () => {
  const hook = createDelegateTaskEnglishDirectiveHook()
  const handler = hook["tool.execute.before"]

  describe("#given a task tool call with a targeted subagent_type", () => {
    const targetTypes = ["explore", "librarian", "oracle", "plan"]

    for (const subagentType of targetTypes) {
      describe(`#when subagent_type is "${subagentType}"`, () => {
        it(`#then should append English directive to prompt`, async () => {
          const originalPrompt = "Find auth patterns in the codebase"
          const input = { tool: "Task", sessionID: "ses_123", callID: "call_1", input: { subagent_type: subagentType, prompt: originalPrompt } }
          const output = { title: "", output: "", metadata: undefined }

          await handler(input, output)

          expect(input.input.prompt).toBe(`${originalPrompt}\n\n${ENGLISH_DIRECTIVE}`)
        })
      })
    }
  })

  describe("#given a task tool call with a non-targeted subagent_type", () => {
    describe("#when subagent_type is 'metis'", () => {
      it("#then should not modify the prompt", async () => {
        const originalPrompt = "Analyze this request"
        const input = { tool: "Task", sessionID: "ses_123", callID: "call_1", input: { subagent_type: "metis", prompt: originalPrompt } }
        const output = { title: "", output: "", metadata: undefined }

        await handler(input, output)

        expect(input.input.prompt).toBe(originalPrompt)
      })
    })
  })

  describe("#given a task tool call using category instead of subagent_type", () => {
    describe("#when only category is provided", () => {
      it("#then should not modify the prompt", async () => {
        const originalPrompt = "Fix the button styling"
        const input = { tool: "Task", sessionID: "ses_123", callID: "call_1", input: { category: "visual-engineering", prompt: originalPrompt } }
        const output = { title: "", output: "", metadata: undefined }

        await handler(input, output)

        expect(input.input.prompt).toBe(originalPrompt)
      })
    })
  })

  describe("#given a non-task tool call", () => {
    describe("#when tool is 'Bash'", () => {
      it("#then should not modify anything", async () => {
        const input = { tool: "Bash", sessionID: "ses_123", callID: "call_1", input: { command: "ls" } }
        const output = { title: "", output: "", metadata: undefined }

        await handler(input, output)

        expect(input.input).toEqual({ command: "ls" })
      })
    })
  })

  describe("#given a task tool call with empty prompt", () => {
    describe("#when prompt is empty string", () => {
      it("#then should still append directive", async () => {
        const input = { tool: "Task", sessionID: "ses_123", callID: "call_1", input: { subagent_type: "explore", prompt: "" } }
        const output = { title: "", output: "", metadata: undefined }

        await handler(input, output)

        expect(input.input.prompt).toBe(`\n\n${ENGLISH_DIRECTIVE}`)
      })
    })
  })

  describe("#given TARGET_SUBAGENT_TYPES constant", () => {
    it("#then should contain exactly explore, librarian, oracle, and plan", () => {
      expect(TARGET_SUBAGENT_TYPES).toEqual(["explore", "librarian", "oracle", "plan"])
    })
  })

  describe("#given ENGLISH_DIRECTIVE constant", () => {
    it("#then should be bold uppercase text", () => {
      expect(ENGLISH_DIRECTIVE).toContain("**")
      expect(ENGLISH_DIRECTIVE).toMatch(/[A-Z]/)
    })

    it("#then should instruct English-only thinking and responding", () => {
      const lower = ENGLISH_DIRECTIVE.toLowerCase()
      expect(lower).toContain("english")
    })
  })
})
