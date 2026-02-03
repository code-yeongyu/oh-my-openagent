import {
  detectPhaseFromContext,
  getRulesForPhase,
  type TaskPhase,
} from "../../shared/phase-aware-rules"
import { createTextPart } from "../../shared/part-factory"

export function createPhaseRulesInjectorHook() {
  const injectedSessions = new Set<string>()

  return {
    "chat.message": async (
      input: { sessionID: string; messageID?: string },
      output: {
        parts?: Array<any>
      }
    ): Promise<void> => {
      // Only inject once per session
      if (injectedSessions.has(input.sessionID)) {
        return
      }

      const promptText = output.parts
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")
        .trim() || ""

      if (!promptText) {
        return
      }

      injectedSessions.add(input.sessionID)

      const phase: TaskPhase = detectPhaseFromContext(promptText)
      const rules = getRulesForPhase(phase)

      if (rules.length > 0) {
        const rulesText = rules.map((rule) => `- ${rule}`).join("\n")
        const injection = `\n\n[PHASE-AWARE RULES]\nDetected phase: ${phase}\n${rulesText}\n`
        
        if (!output.parts) {
          output.parts = []
        }
        output.parts.push(
          createTextPart({
            sessionID: input.sessionID,
            messageID: input.messageID,
            text: injection,
          })
        )
      }
    },
  }
}
