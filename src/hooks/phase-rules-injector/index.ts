import {
  detectPhaseFromContext,
  getRulesForPhase,
  type TaskPhase,
} from "../../shared/phase-aware-rules"

export function createPhaseRulesInjectorHook() {
  return {
    "chat.message": async (
      _input: { sessionID: string },
      output: {
        parts?: Array<{ type: string; text?: string }>
      }
    ): Promise<void> => {
      const promptText = output.parts
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")
        .trim() || ""

      if (!promptText) {
        return
      }

      const phase: TaskPhase = detectPhaseFromContext(promptText)
      const rules = getRulesForPhase(phase)

      if (rules.length > 0) {
        const rulesText = rules.map((rule) => `- ${rule}`).join("\n")
        const injection = `\n\n[PHASE-AWARE RULES]\nDetected phase: ${phase}\n${rulesText}\n`
        
        output.parts?.push({ type: "text", text: injection })
      }
    },
  }
}
