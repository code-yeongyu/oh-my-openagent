import { subagentSessions } from "../../features/claude-code-session-state"
import {
  getMessageSessionID,
  repairMissingToolResults,
  repairSubAgentMissingToolResults,
} from "./tool-result-repair"
import type { MessageWithParts } from "./types"

export function validateToolPairsForMessages(messages: MessageWithParts[]): void {
  for (let i = 0; i < messages.length; i++) {
    const messageInfo = messages[i].info

    if (messageInfo.role !== "assistant") {
      continue
    }

    const sessionID = getMessageSessionID(messageInfo)
    if (sessionID && subagentSessions.has(sessionID)) {
      repairSubAgentMissingToolResults(messages, i, sessionID)
      continue
    }

    repairMissingToolResults(messages, i)
  }
}
