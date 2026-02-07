export type FallbackEntry = {
  providers: string[]
  model: string
  variant?: string // Entry-specific variant (e.g., GPT→high, Opus→max)
}

export type ModelRequirement = {
  fallbackChain: FallbackEntry[]
  variant?: string // Default variant (used when entry doesn't specify one)
  requiresModel?: string // If set, only activates when this model is available (fuzzy match)
  requiresAnyModel?: boolean // If true, requires at least ONE model in fallbackChain to be available (or empty availability treated as unavailable)
  requiresProvider?: string[] // If set, only activates when any of these providers is connected
}

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["zai-coding-plan"], model: "glm-4.7" },
      { providers: ["opencode"], model: "glm-4.7-free" },
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
    ],
    requiresProvider: ["openai", "github-copilot", "opencode"],
  },
  oracle: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
    ],
  },
   librarian: {
     fallbackChain: [
       { providers: ["zai-coding-plan"], model: "glm-4.7" },
       { providers: ["opencode"], model: "glm-4.7-free" },
       { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
     ],
   },
  explore: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "grok-code-fast-1" },
      { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "gpt-5-nano" },
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
      { providers: ["zai-coding-plan"], model: "glm-4.6v" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "gpt-5-nano" },
    ],
  },
  prometheus: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
  metis: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
    ],
  },
  momus: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "medium" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
}

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["zai-coding-plan"], model: "glm-4.7" },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "xhigh" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
    ],
  },
  deep: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
    ],
    requiresModel: "gpt-5.3-codex",
  },
  artistry: {
    fallbackChain: [
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
    ],
    requiresModel: "gemini-3-pro",
  },
  quick: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
      { providers: ["opencode"], model: "gpt-5-nano" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
  writing: {
    fallbackChain: [
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
      { providers: ["zai-coding-plan"], model: "glm-4.7" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
    ],
  },
}
