/**
 * ModelPreset: per-agent, per-model prompt + config overrides.
 * The resolver (resolveModelPreset) loads these and applies them to AgentConfig.
 * 
 * This replaces the if/else chains in createOracleAgent, createExploreAgent, etc.
 * Adding a new model = adding a new preset file, not editing agent code.
 */
export interface ModelPreset {
  agent: string
  model: string | string[]
  /** Either inline prompt text OR a promptKey for later resolution */
  prompt?: string
  /** References a prompt string in the prompt resolver (@see PromptResolver) */
  promptKey?: string
  /** Path to a prompt markdown file (alternative to inline prompt/promptKey) */
  promptPath?: string
  config?: ModelPresetConfig
  priority?: number
  description?: string
}

export interface ModelPresetConfig {
  thinking?: { type: "enabled"; budgetTokens: number }
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  color?: string
  [key: string]: unknown
}

export interface ModelPresetMatch {
  preset: ModelPreset
  score: number
}
