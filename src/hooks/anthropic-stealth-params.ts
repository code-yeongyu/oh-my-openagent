/**
 * Claude Code stealth params for Anthropic OAuth requests.
 *
 * Modifies the LLM request parameters to match what Claude Code sends:
 *   - Billing header as first system prompt block
 *   - Claude Code system instruction as second system prompt block
 *   - Cloaking metadata.user_id
 *
 * This works alongside anthropic-stealth-headers.ts to complete the
 * Claude Code client signature required for Max 20x tier.
 */

import {
  isAnthropicOAuthToken,
  createBillingHeaderText,
  CLAUDE_CODE_SYSTEM_INSTRUCTION,
  generateCloakingUserId,
} from "./anthropic-stealth-headers"

import type { ProviderContext } from "@opencode-ai/plugin"
import type { Model, UserMessage } from "@opencode-ai/sdk"

/**
 * Injects Claude Code billing and system prompt blocks into the
 * request options for Anthropic OAuth requests.
 */
export async function anthropicStealthParamsHook(
  input: {
    sessionID: string
    agent: string
    model: Model
    provider: ProviderContext
    message: UserMessage
  },
  output: {
    temperature: number
    topP: number
    topK: number
    maxOutputTokens: number | undefined
    options: Record<string, any>
  },
): Promise<void> {
  // Only apply to anthropic provider
  if (input.model.providerID !== "anthropic") return

  const apiKey = input.provider.options?.apiKey
  if (!isAnthropicOAuthToken(apiKey)) return

  // Skip haiku models — they don't need/support the billing injection
  if (input.model.id.includes("haiku")) return

  // Inject cloaking metadata user_id
  if (!output.options.metadata?.user_id) {
    output.options.metadata = {
      ...(output.options.metadata ?? {}),
      user_id: generateCloakingUserId(),
    }
  }

  // Inject billing header and system instruction into system prompt.
  // OpenCode passes options through to the Anthropic SDK; the `system`
  // field takes an array of {type: "text", text: string} blocks.
  const rawSystem: Array<{ type: string; text: string }> = Array.isArray(output.options.system)
    ? output.options.system
    : typeof output.options.system === "string"
      ? [{ type: "text", text: output.options.system }]
      : []
  // Anthropic rejects text blocks with empty `text` — filter them before re-assembly.
  const existingSystem = rawSystem.filter(
    (b) => typeof b.text === "string" && b.text.length > 0,
  )

  // Check if billing header is already injected (idempotency)
  const hasBilling = existingSystem.some(
    (block) => typeof block.text === "string" && block.text.includes("x-anthropic-billing-header:"),
  )

  if (!hasBilling) {
    // Build billing payload from the current request shape
    const billingPayload = {
      system: existingSystem.map((b) => b.text),
    }

    const billingBlock = { type: "text" as const, text: createBillingHeaderText(billingPayload) }
    const instructionBlock = { type: "text" as const, text: CLAUDE_CODE_SYSTEM_INSTRUCTION }

    // Prepend billing + instruction before existing system blocks
    output.options.system = [billingBlock, instructionBlock, ...existingSystem]
  }
}
