import type { OhMyOpenCodeConfig } from "../config"
import type { AgentOverrides } from "../config/schema/agent-overrides"
import { getSessionAgent } from "../features/claude-code-session-state"
import { log } from "../shared"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { scheduleDeferredModelOverride } from "./ultrawork-db-model-override"
import { resolveValidUltraworkVariant } from "./ultrawork-variant-availability"

const CODE_BLOCK = /```[\s\S]*?```/g
const INLINE_CODE = /`[^`]+`/g
const ULTRAWORK_PATTERN = /\b(ultrawork|ulw)\b/i

export function detectUltrawork(text: string): boolean {
  const clean = text.replace(CODE_BLOCK, "").replace(INLINE_CODE, "")
  return ULTRAWORK_PATTERN.test(clean)
}

function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
  return parts.filter((part) => part.type === "text").map((part) => part.text || "").join("")
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

type ModelDescriptor = {
  providerID: string
  modelID: string
}

function isSameModel(current: unknown, target: ModelDescriptor): boolean {
  if (typeof current !== "object" || current === null) return false
  const currentRecord = current as Record<string, unknown>
  return currentRecord["providerID"] === target.providerID && currentRecord["modelID"] === target.modelID
}

function getMessageModel(current: unknown): ModelDescriptor | undefined {
  if (typeof current !== "object" || current === null) return undefined
  const currentRecord = current as Record<string, unknown>
  const providerID = currentRecord["providerID"]
  const modelID = currentRecord["modelID"]
  if (typeof providerID !== "string" || typeof modelID !== "string") return undefined
  return { providerID, modelID }
}

export function resolveUltraworkOverride(
  pluginConfig: OhMyOpenCodeConfig,
  inputAgentName: string | undefined,
  output: {
    message: Record<string, unknown>
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  },
  sessionID?: string,
): UltraworkOverrideResult | null {
  const promptText = extractPromptText(output.parts)
  if (!detectUltrawork(promptText)) return null

  const messageAgentName =
    typeof output.message["agent"] === "string" ? (output.message["agent"] as string) : undefined
  const sessionAgentName = sessionID ? getSessionAgent(sessionID) : undefined
  const rawAgentName = inputAgentName ?? messageAgentName ?? sessionAgentName
  if (!rawAgentName || !pluginConfig.agents) return null

  const agentConfigKey = getAgentConfigKey(rawAgentName)
  const agentConfig = pluginConfig.agents[agentConfigKey as keyof AgentOverrides]
  const ultraworkConfig = agentConfig?.ultrawork
  if (!ultraworkConfig?.model && !ultraworkConfig?.variant) return null

  if (!ultraworkConfig.model) {
    return { variant: ultraworkConfig.variant }
  }

  const modelParts = ultraworkConfig.model.split("/")
  if (modelParts.length < 2) return null

  return {
    providerID: modelParts[0],
    modelID: modelParts.slice(1).join("/"),
    variant: ultraworkConfig.variant,
  }
}

function applyResolvedUltraworkOverride(args: {
  override: UltraworkOverrideResult
  validatedVariant: string | undefined
  output: { message: Record<string, unknown> }
  inputAgentName: string | undefined
  tui: unknown
}): void {
  const { override, validatedVariant, output, inputAgentName, tui } = args
  if (validatedVariant) {
    output.message["variant"] = validatedVariant
    output.message["thinking"] = validatedVariant
  }

  if (!override.providerID || !override.modelID) return

  const targetModel = { providerID: override.providerID, modelID: override.modelID }
  if (isSameModel(output.message.model, targetModel)) {
    log(`[ultrawork-model-override] Skip override; target model already active: ${override.modelID}`)
    return
  }

  const messageId = output.message["id"] as string | undefined
  if (!messageId) {
    log("[ultrawork-model-override] No message ID found, falling back to direct mutation")
    output.message.model = targetModel
    return
  }

  const fromModel = (output.message.model as { modelID?: string } | undefined)?.modelID ?? "unknown"
  const agentConfigKey = getAgentConfigKey(
    inputAgentName ??
    (typeof output.message["agent"] === "string" ? (output.message["agent"] as string) : "unknown"),
  )

  scheduleDeferredModelOverride(messageId, targetModel, validatedVariant)

  log(`[ultrawork-model-override] ${fromModel} -> ${override.modelID} (deferred DB)`, {
    agent: agentConfigKey,
  })

  showToast(
    tui,
    "Ultrawork Model Override",
    `${fromModel} → ${override.modelID}. Maximum precision engaged.`,
  )
}

export function applyUltraworkModelOverrideOnMessage(
  pluginConfig: OhMyOpenCodeConfig,
  inputAgentName: string | undefined,
  output: {
    message: Record<string, unknown>
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  },
  tui: unknown,
  sessionID?: string,
  client?: unknown,
): void | Promise<void> {
  const override = resolveUltraworkOverride(pluginConfig, inputAgentName, output, sessionID)
  if (!override) return

  const currentModel = getMessageModel(output.message.model)
  const variantTargetModel = override.providerID && override.modelID
    ? { providerID: override.providerID, modelID: override.modelID }
    : currentModel

  if (!client || typeof (client as { provider?: { list?: unknown } }).provider?.list !== "function") {
    applyResolvedUltraworkOverride({ override, validatedVariant: override.variant, output, inputAgentName, tui })
    return
  }

  return resolveValidUltraworkVariant(client, variantTargetModel, override.variant)
    .then((validatedVariant) => {
      if (override.variant && !validatedVariant) {
        log("[ultrawork-model-override] Skip invalid ultrawork variant override", {
          variant: override.variant,
          providerID: variantTargetModel?.providerID,
          modelID: variantTargetModel?.modelID,
        })
      }

      applyResolvedUltraworkOverride({ override, validatedVariant, output, inputAgentName, tui })
    })
    .catch((error) => {
      log("[ultrawork-model-override] Failed to validate ultrawork variant via SDK", {
        variant: override.variant,
        error: String(error),
        providerID: variantTargetModel?.providerID,
        modelID: variantTargetModel?.modelID,
      })
      applyResolvedUltraworkOverride({ override, validatedVariant: undefined, output, inputAgentName, tui })
    })
}
