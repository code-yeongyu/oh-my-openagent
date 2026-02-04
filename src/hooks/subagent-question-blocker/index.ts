import type { Hooks } from "@opencode-ai/plugin"
import { subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared"

export function createSubagentQuestionBlockerHook(): Hooks {
  return {
    "tool.execute.before": async (input) => {
      const toolName = input.tool?.toLowerCase()
      if (toolName !== "question" && toolName !== "askuserquestion") {
        return
      }

      if (!subagentSessions.has(input.sessionID)) {
        return
      }

      log("[subagent-question-blocker] Blocking question tool call from subagent session", {
        sessionID: input.sessionID,
        tool: input.tool,
      })

      throw new Error(
        "Question tool is disabled for subagent sessions. " +
        "Subagents should complete their work autonomously without asking questions to users. " +
        "If you need clarification, return to the parent agent with your findings and uncertainties."
      )
    },
  }
}
