import { subagentSessions } from "../../features/claude-code-session-state"
import {
  getMessageSessionID,
  repairMissingToolResults,
  repairSubAgentMissingToolResults,
} from "./tool-result-repair"
import type { MessagesTransformHook } from "./types"

export function createToolPairValidatorHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      for (let i = 0; i < output.messages.length; i++) {
        const messageInfo = output.messages[i].info

        if (messageInfo.role !== "assistant") {
          continue
        }

        const sessionID = getMessageSessionID(messageInfo)
        if (sessionID && subagentSessions.has(sessionID)) {
          repairSubAgentMissingToolResults(output.messages, i, sessionID)
          continue
        }

        repairMissingToolResults(output.messages, i)
      }
    },
  }
}
