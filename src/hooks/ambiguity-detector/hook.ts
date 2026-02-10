import type { PluginInput } from "@opencode-ai/plugin"
import { detectAmbiguity, extractPromptText } from "./patterns"
import type { ChatMessageInput, ChatMessageOutput } from "./types"

function buildClarificationGuidance(reasons: string[]): string {
  const reasonText = reasons.length > 0 ? reasons.join(", ") : "insufficient context"
  return [
    "Clarification needed before implementation:",
    `Detected ambiguity signals: ${reasonText}.`,
    "Please include: target file/function, expected outcome, and measurable success criteria.",
  ].join("\n")
}

export function createAmbiguityDetectorHook(_ctx: PluginInput) {
  return {
    "chat.message": async (input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
      if (!input.sessionID) return

      const promptText = extractPromptText(output.parts)
      if (!promptText) return

      const result = detectAmbiguity(promptText)
      if (!result.ambiguous) return

      output.parts.push({
        type: "text",
        text: buildClarificationGuidance(result.reasons),
      })
    },
  }
}
