import type { OhMyOpenCodeConfig } from "../config"
import type { AgentOverrides } from "../config/schema/agent-overrides"
import { log } from "../shared"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { scheduleDeferredModelOverride } from "./ultrawork-db-model-override"

const CODE_BLOCK = /```[\s\S]*?```/g
const INLINE_CODE = /`[^`]+`/g
const ULTRAWORK_PATTERN = /\b(ultrawork|ulw)\b/i

export function detectUltrawork(text: string): boolean {
  const clean = text.replace(CODE_BLOCK, "").replace(INLINE_CODE, "")
  return ULTRAWORK_PATTERN.test(clean)
}

function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
  return parts.filter((p) => p.type === "text").map((p) => p.text || "").join("")
}

type ToastFn = {
  showToast: (o: { body: Record<string, unknown> }) => Promise<unknown>
}

function showToast(tui: unknown, title: string, message: string): void {
  const toastFn = tui as Partial<ToastFn>
  if (typeof toastFn.showToast !== "function") return
  toastFn.showToast({
    body: { title, message, variant: "warning" as const, duration: 3000 },
  }).catch(() => {})
}

export type UltraworkOverrideResult = {
  providerID?: string
  modelID?: string
  variant?: string
}

/**
 * Resolves the ultrawork model override config for the given agent and prompt text.
 * Returns null if no override should be applied.
 */
export function resolveUltraworkOverride(
  pluginConfig: OhMyOpenCodeConfig,
  inputAgentName: string | undefined,
  output: {
    message: Record<string, unknown>
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  },
): UltraworkOverrideResult | null {
  const promptText = extractPromptText(output.parts)
  if (!detectUltrawork(promptText)) return null

  const messageAgentName =
    typeof output.message["agent"] === "string" ? (output.message["agent"] as string) : undefined
  const rawAgentName = inputAgentName ?? messageAgentName
  if (!rawAgentName || !pluginConfig.agents) return null

  const agentConfigKey = getAgentConfigKey(rawAgentName)
  const agentConfig = pluginConfig.agents[agentConfigKey as keyof AgentOverrides]
  const ultraworkConfig = agentConfig?.ultrawork
  if (!ultraworkConfig?.model && !ultraworkConfig?.variant) return null

  if (!ultraworkConfig.model) {
    return {
      variant: ultraworkConfig.variant,
    }
  }

  const modelParts = ultraworkConfig.model.split("/")
  if (modelParts.length < 2) return null

  return {
    providerID: modelParts[0],
    modelID: modelParts.slice(1).join("/"),
    variant: ultraworkConfig.variant,
  }
}

/**
 * Applies ultrawork model override using a deferred DB update strategy.
 *
 * Instead of directly mutating output.message.model (which would cause the TUI
 * bottom bar to show the override model), this schedules a queueMicrotask that
 * updates the message model directly in SQLite AFTER Session.updateMessage()
 * saves the original model, but BEFORE loop() reads it for the API call.
 *
 * Result: API call uses opus, TUI bottom bar stays on sonnet.
 */
export function applyUltraworkModelOverrideOnMessage(
  pluginConfig: OhMyOpenCodeConfig,
  inputAgentName: string | undefined,
  output: {
    message: Record<string, unknown>
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  },
  tui: unknown,
): void {
  const override = resolveUltraworkOverride(pluginConfig, inputAgentName, output)
  if (!override) return

  if (!override.providerID || !override.modelID) {
    if (override.variant) {
      output.message["variant"] = override.variant
      output.message["thinking"] = override.variant
    }
    return
  }

  const messageId = output.message["id"] as string | undefined
  if (!messageId) {
    log("[ultrawork-model-override] No message ID found, falling back to direct mutation")
    output.message.model = { providerID: override.providerID, modelID: override.modelID }
    if (override.variant) {
      output.message["variant"] = override.variant
      output.message["thinking"] = override.variant
    }
    return
  }

  const fromModel = (output.message.model as { modelID?: string } | undefined)?.modelID ?? "unknown"
  const agentConfigKey = getAgentConfigKey(
    inputAgentName ??
    (typeof output.message["agent"] === "string" ? (output.message["agent"] as string) : "unknown"),
  )

  scheduleDeferredModelOverride(
    messageId,
    { providerID: override.providerID, modelID: override.modelID },
    override.variant,
  )

  log(`[ultrawork-model-override] ${fromModel} -> ${override.modelID} (deferred DB)`, {
    agent: agentConfigKey,
  })

  showToast(
    tui,
    "Ultrawork Model Override",
    `${fromModel} \u2192 ${override.modelID}. Maximum precision engaged.`,
  )
}
