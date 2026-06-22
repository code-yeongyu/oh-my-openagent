import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import {
  HOOK_NAME,
  IDEMPOTENCY_MARKER,
  INTENT_PRESERVATION_BLOCK,
  PLANS_DIR,
} from "./constants"
import {
  extractPromptText,
  findMostRecentPlanFile,
  hasPhaseTransition,
  type MessagePart,
  planHasConstruct,
} from "./phase-detector"

type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

type ChatMessageOutput = {
  message: Record<string, unknown>
  parts: MessagePart[]
}

export function createDesignIntentPreserverHook(_ctx: PluginInput) {
  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageOutput,
    ): Promise<void> => {
      const promptText = extractPromptText(output.parts)

      if (promptText.includes(IDEMPOTENCY_MARKER)) {
        return
      }

      if (!hasPhaseTransition(promptText)) {
        return
      }

      const plansDir = join(_ctx.directory, PLANS_DIR)
      const planPath = findMostRecentPlanFile(plansDir)
      if (!planPath) {
        return
      }

      if (!planHasConstruct(planPath)) {
        return
      }

      const textPartIndex = output.parts.findIndex(
        (p) => p.type === "text" && p.text !== undefined,
      )
      if (textPartIndex === -1) return

      const originalText = output.parts[textPartIndex].text ?? ""
      output.parts[textPartIndex].text =
        `${INTENT_PRESERVATION_BLOCK}\n\n---\n\n${originalText}`

      log(`[${HOOK_NAME}] injected design intent guardrail`, {
        sessionID: input.sessionID,
        planPath,
      })
    },
  }
}
