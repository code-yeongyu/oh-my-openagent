// Maps model IDs to their "high reasoning" variant (internal convention)
// For OpenAI models, this signals that reasoning_effort should be set to "high"
const HIGH_VARIANT_MAP: Record<string, string> = {
  // Claude
  "claude-sonnet-4-5": "claude-sonnet-4-5-high",
  "claude-opus-4-5": "claude-opus-4-5-high",
  // Gemini
  "gemini-3-pro": "gemini-3-pro-high",
  "gemini-3-pro-low": "gemini-3-pro-high",
  // GPT-5
  "gpt-5": "gpt-5-high",
  "gpt-5-mini": "gpt-5-mini-high",
  "gpt-5-nano": "gpt-5-nano-high",
  "gpt-5-pro": "gpt-5-pro-high",
  "gpt-5-chat-latest": "gpt-5-chat-latest-high",
  // GPT-5.1
  "gpt-5.1": "gpt-5.1-high",
  "gpt-5.1-chat-latest": "gpt-5.1-chat-latest-high",
  "gpt-5.1-codex": "gpt-5.1-codex-high",
  "gpt-5.1-codex-mini": "gpt-5.1-codex-mini-high",
  "gpt-5.1-codex-max": "gpt-5.1-codex-max-high",
  // GPT-5.2
  "gpt-5.2": "gpt-5.2-high",
  "gpt-5.2-chat-latest": "gpt-5.2-chat-latest-high",
  "gpt-5.2-pro": "gpt-5.2-pro-high",
}

const ALREADY_HIGH: Set<string> = new Set([
  // Claude
  "claude-sonnet-4-5-high",
  "claude-opus-4-5-high",
  // Gemini
  "gemini-3-pro-high",
  // GPT-5
  "gpt-5-high",
  "gpt-5-mini-high",
  "gpt-5-nano-high",
  "gpt-5-pro-high",
  "gpt-5-chat-latest-high",
  // GPT-5.1
  "gpt-5.1-high",
  "gpt-5.1-chat-latest-high",
  "gpt-5.1-codex-high",
  "gpt-5.1-codex-mini-high",
  "gpt-5.1-codex-max-high",
  // GPT-5.2
  "gpt-5.2-high",
  "gpt-5.2-chat-latest-high",
  "gpt-5.2-pro-high",
])

export const THINKING_CONFIGS: Record<string, Record<string, unknown>> = {
  anthropic: {
    thinking: {
      type: "enabled",
      budgetTokens: 64000,
    },
    maxTokens: 128000,
  },
  "amazon-bedrock": {
    reasoningConfig: {
      type: "enabled",
      budgetTokens: 32000,
    },
    maxTokens: 64000,
  },
  google: {
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingLevel: "HIGH",
        },
      },
    },
  },
  "google-vertex": {
    providerOptions: {
      "google-vertex": {
        thinkingConfig: {
          thinkingLevel: "HIGH",
        },
      },
    },
  },
}

const THINKING_CAPABLE_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4", "claude-opus-4", "claude-3"],
  "amazon-bedrock": ["claude", "anthropic"],
  google: ["gemini-2", "gemini-3"],
  "google-vertex": ["gemini-2", "gemini-3"],
}

export function getHighVariant(modelID: string): string | null {
  if (ALREADY_HIGH.has(modelID)) {
    return null
  }
  return HIGH_VARIANT_MAP[modelID] ?? null
}

export function isAlreadyHighVariant(modelID: string): boolean {
  return ALREADY_HIGH.has(modelID) || modelID.endsWith("-high")
}

export function getThinkingConfig(
  providerID: string,
  modelID: string
): Record<string, unknown> | null {
  if (isAlreadyHighVariant(modelID)) {
    return null
  }

  const config = THINKING_CONFIGS[providerID]
  const capablePatterns = THINKING_CAPABLE_MODELS[providerID]

  if (!config || !capablePatterns) {
    return null
  }

  const modelLower = modelID.toLowerCase()
  const isCapable = capablePatterns.some((pattern) =>
    modelLower.includes(pattern.toLowerCase())
  )

  return isCapable ? config : null
}
