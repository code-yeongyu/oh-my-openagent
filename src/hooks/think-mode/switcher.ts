/**
 * Think Mode Switcher
 *
 * This module handles "thinking mode" activation for reasoning-capable models.
 * When a user includes "think" keywords in their prompt, models are upgraded to
 * their high-reasoning variants with extended thinking budgets.
 *
 * PROVIDER ALIASING:
 * GitHub Copilot acts as a proxy provider that routes to underlying providers
 * (Anthropic, Google, OpenAI). We resolve the proxy to the actual provider
 * based on model name patterns, allowing GitHub Copilot to inherit thinking
 * configurations without duplication.
 *
 * NORMALIZATION:
 * Model IDs are normalized (dots → hyphens in version numbers) to handle API
 * inconsistencies defensively while maintaining backwards compatibility.
 */

/**
 * Extracts provider-specific prefix from model ID (if present).
 * Custom providers may use prefixes for routing (e.g., vertex_ai/, openai/).
 *
 * @example
 * extractModelPrefix("vertex_ai/claude-sonnet-4-6") // { prefix: "vertex_ai/", base: "claude-sonnet-4-6" }
 * extractModelPrefix("claude-sonnet-4-6") // { prefix: "", base: "claude-sonnet-4-6" }
 * extractModelPrefix("openai/gpt-5.2") // { prefix: "openai/", base: "gpt-5.2" }
 */
function extractModelPrefix(modelID: string): { prefix: string; base: string } {
  const slashIndex = modelID.indexOf("/")
  if (slashIndex === -1) {
    return { prefix: "", base: modelID }
  }
  return {
    prefix: modelID.slice(0, slashIndex + 1),
    base: modelID.slice(slashIndex + 1),
  }
}

/**
 * Normalizes model IDs to use consistent hyphen formatting.
 * GitHub Copilot may use dots (claude-opus-4.6) but our maps use hyphens (claude-opus-4-6).
 * This ensures lookups work regardless of format.
 *
 * @example
 * normalizeModelID("claude-opus-4.6") // "claude-opus-4-6"
 * normalizeModelID("gemini-3.5-pro") // "gemini-3-5-pro"
 * normalizeModelID("gpt-5.2") // "gpt-5-2"
 * normalizeModelID("vertex_ai/claude-opus-4.6") // "vertex_ai/claude-opus-4-6"
 */
function normalizeModelID(modelID: string): string {
  // Replace dots with hyphens when followed by a digit
  // This handles version numbers like 4.5 → 4-5, 5.2 → 5-2
  return modelID.replace(/\.(\d+)/g, "-$1")
}



// Maps model IDs to their "high reasoning" variant (internal convention)
// For OpenAI models, this signals that reasoning_effort should be set to "high"
const HIGH_VARIANT_MAP: Record<string, string> = {
  // Claude
  "claude-sonnet-4-6": "claude-sonnet-4-6-high",
  "claude-opus-4-6": "claude-opus-4-6-high",
   // Gemini
   "gemini-3-pro": "gemini-3-pro-high",
   "gemini-3-pro-low": "gemini-3-pro-high",
   "gemini-3-flash": "gemini-3-flash-high",
  // GPT-5
  "gpt-5": "gpt-5-high",
  "gpt-5-mini": "gpt-5-mini-high",
  "gpt-5-nano": "gpt-5-nano-high",
  "gpt-5-pro": "gpt-5-pro-high",
  "gpt-5-chat-latest": "gpt-5-chat-latest-high",
  // GPT-5.1
  "gpt-5-1": "gpt-5-1-high",
  "gpt-5-1-chat-latest": "gpt-5-1-chat-latest-high",
  "gpt-5-1-codex": "gpt-5-1-codex-high",
  "gpt-5-1-codex-mini": "gpt-5-1-codex-mini-high",
  "gpt-5-1-codex-max": "gpt-5-1-codex-max-high",
  // GPT-5.2
  "gpt-5-2": "gpt-5-2-high",
  "gpt-5-2-chat-latest": "gpt-5-2-chat-latest-high",
  "gpt-5-2-pro": "gpt-5-2-pro-high",
  // Antigravity (Google)
  "antigravity-gemini-3-pro": "antigravity-gemini-3-pro-high",
  "antigravity-gemini-3-flash": "antigravity-gemini-3-flash-high",
}

const ALREADY_HIGH: Set<string> = new Set(Object.values(HIGH_VARIANT_MAP))


export function getHighVariant(modelID: string): string | null {
  const normalized = normalizeModelID(modelID)
  const { prefix, base } = extractModelPrefix(normalized)

  // Check if already high variant (with or without prefix)
  if (ALREADY_HIGH.has(base) || base.endsWith("-high")) {
    return null
  }

  // Look up high variant for base model
  const highBase = HIGH_VARIANT_MAP[base]
  if (!highBase) {
    return null
  }

  // Preserve prefix in the high variant
  return prefix + highBase
}

export function isAlreadyHighVariant(modelID: string): boolean {
  const normalized = normalizeModelID(modelID)
  const { base } = extractModelPrefix(normalized)
  return ALREADY_HIGH.has(base) || base.endsWith("-high")
}


