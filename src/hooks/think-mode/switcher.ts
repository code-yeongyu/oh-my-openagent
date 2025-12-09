const HIGH_VARIANT_MAP: Record<string, string> = {
  "claude-sonnet-4-5": "claude-sonnet-4-5-high",
  "claude-opus-4-5": "claude-opus-4-5-high",
  "gpt-5.1": "gpt-5.1-high",
  "gpt-5.1-medium": "gpt-5.1-high",
  "gpt-5.1-codex": "gpt-5.1-codex-high",
  "gemini-3-pro": "gemini-3-pro-high",
  "gemini-3-pro-low": "gemini-3-pro-high",
}

const ALREADY_HIGH: Set<string> = new Set([
  "claude-sonnet-4-5-high",
  "claude-opus-4-5-high",
  "gpt-5.1-high",
  "gpt-5.1-codex-high",
  "gemini-3-pro-high",
])

export const THINKING_CONFIGS: Record<string, Record<string, unknown>> = {
  anthropic: {
    thinking: {
      type: "enabled",
      budgetTokens: 64000,
    },
  },
  "amazon-bedrock": {
    reasoningConfig: {
      type: "enabled",
      budgetTokens: 32000,
    },
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
