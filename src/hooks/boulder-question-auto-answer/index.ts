import type { Hooks } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { readState } from "../boulder-loop/storage"

export const HOOK_NAME = "boulder-question-skipper"

export function createBoulderQuestionAutoAnswerHook(
  directory: string,
  stateDir?: string
): Hooks {
  return {
    "tool.execute.before": async (input) => {
      const toolName = input.tool?.toLowerCase()
      if (toolName !== "question" && toolName !== "askuserquestion") {
        return
      }

      const state = readState(directory, stateDir)
      if (!state?.active) {
        return
      }

      log(`[${HOOK_NAME}] Skipping question in Boulder mode`, {
        sessionID: input.sessionID,
        timeRemaining: state.deadline - Date.now(),
      })

      throw new Error("[BOULDER MODE] Question skipped. Decide autonomously.")
    },
  }
}
