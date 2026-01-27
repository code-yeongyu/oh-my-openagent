import { describe, test, expect, beforeEach } from "bun:test"
import { createSubagentQuestionBlockerHook } from "./index"
import { subagentSessions, _resetForTesting } from "../../features/claude-code-session-state"

describe("createSubagentQuestionBlockerHook", () => {
  const hook = createSubagentQuestionBlockerHook()

  beforeEach(() => {
    _resetForTesting()
  })

  describe("tool.execute.before", () => {
    test("allows question tool for non-subagent sessions", async () => {
      //#given
      const sessionID = "ses_main"
      const input = { tool: "question", sessionID, callID: "call_1" }
      const output = { args: { questions: [] } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    test("blocks question tool for subagent sessions", async () => {
      //#given
      const sessionID = "ses_subagent"
      subagentSessions.add(sessionID)
      const input = { tool: "question", sessionID, callID: "call_1" }
      const output = { args: { questions: [] } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("Question tool is disabled for subagent sessions")
    })

    test("blocks Question tool (case insensitive) for subagent sessions", async () => {
      //#given
      const sessionID = "ses_subagent"
      subagentSessions.add(sessionID)
      const input = { tool: "Question", sessionID, callID: "call_1" }
      const output = { args: { questions: [] } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("Question tool is disabled for subagent sessions")
    })

    test("blocks AskUserQuestion tool for subagent sessions", async () => {
      //#given
      const sessionID = "ses_subagent"
      subagentSessions.add(sessionID)
      const input = { tool: "AskUserQuestion", sessionID, callID: "call_1" }
      const output = { args: { questions: [] } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("Question tool is disabled for subagent sessions")
    })

    test("ignores non-question tools for subagent sessions", async () => {
      //#given
      const sessionID = "ses_subagent"
      subagentSessions.add(sessionID)
      const input = { tool: "bash", sessionID, callID: "call_1" }
      const output = { args: { command: "ls" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })
  })
})
