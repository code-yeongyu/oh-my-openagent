import { subagentSessions } from "../../features/claude-code-session-state"
import {
  diagnoseSubAgentUnpairedToolParts,
  getMessageSessionID,
  repairUnpairedToolParts,
} from "./tool-result-repair"
import type { MessageWithParts } from "./types"

export function validateToolPairsForMessages(messages: MessageWithParts[]): void {
  for (const message of messages) {
    if (message.info.role !== "assistant") {
      continue
    }

    const sessionID = getMessageSessionID(message.info)
    if (sessionID && subagentSessions.has(sessionID)) {
      diagnoseSubAgentUnpairedToolParts(message, sessionID)
      continue
    }

    repairUnpairedToolParts(message)
  }
}
