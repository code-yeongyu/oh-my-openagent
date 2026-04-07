import { log } from "../../shared"
import { classifyIntent, type ComplexityTier } from "./classifier"
import { HAIKU_MODEL } from "./constants"

const MODERATE_THINKING_BUDGET = 8_000
const COMPLEX_THINKING_BUDGET = 32_000

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }

function extractText(parts: ChatMessagePart[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join(" ")
}

function isSisyphusAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  return agentName.toLowerCase().includes("sisyphus")
}

function isThinkingOptions(
  thinking: unknown,
): thinking is { type: string; budgetTokens: number } {
  return (
    typeof thinking === "object" &&
    thinking !== null &&
    "budgetTokens" in thinking
  )
}

export function createIntentComplexityRouterHook(isEnabled: boolean) {
  const sessionTiers = new Map<string, ComplexityTier>()

  return {
    "chat.message": async (
      input: {
        sessionID: string
        parentSessionId?: string
        agent?: string
        model?: { providerID: string; modelID: string }
      },
      output: {
        message: Record<string, unknown>
        parts: ChatMessagePart[]
      }
    ): Promise<void> => {
      if (!isEnabled) return

      if (input.parentSessionId) {
        log("[intent-complexity-router] Skipping subagent session", { sessionID: input.sessionID })
        return
      }

      const text = extractText(output.parts)
      if (!text.trim()) return

      const tier = classifyIntent(text)
      sessionTiers.set(input.sessionID, tier)

      log("[intent-complexity-router] Classified intent", {
        sessionID: input.sessionID,
        tier,
        preview: text.slice(0, 80),
      })

      if (tier === "COMPLEX") return

      output.message["model"] = HAIKU_MODEL
    },

    "chat.params": async (
      input: {
        sessionID: string
        agent?: { name?: string }
        model?: { providerID: string; modelID: string }
      },
      output: {
        options: Record<string, unknown>
      }
    ): Promise<void> => {
      if (!isEnabled) return
      if (!isSisyphusAgent(input.agent?.name)) return

      const tier = sessionTiers.get(input.sessionID)
      if (!tier || tier === "TRIVIAL") return

      const thinking = output.options.thinking
      if (!isThinkingOptions(thinking)) return

      const budget =
        tier === "MODERATE" ? MODERATE_THINKING_BUDGET : COMPLEX_THINKING_BUDGET

      if (thinking.budgetTokens === budget) return

      thinking.budgetTokens = budget
      log("[intent-complexity-router] Adjusted thinking budget", {
        sessionID: input.sessionID,
        tier,
        budgetTokens: budget,
      })
    },
  }
}
