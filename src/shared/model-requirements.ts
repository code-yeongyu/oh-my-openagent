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
  morpheus: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["zai-coding-plan"], model: "glm-4.7" },
      { providers: ["opencode"], model: "glm-4.7-free" },
    ],
    requiresAnyModel: true,
  },
  keymaker: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
    ],
    requiresProvider: ["openai", "github-copilot", "opencode"],
  },
  merovingian: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
    ],
  },
  operator: {
    fallbackChain: [
      { providers: ["zai-coding-plan"], model: "glm-4.7" },
      { providers: ["opencode"], model: "glm-4.7-free" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
    ],
  },
  trinity: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "grok-code-fast-1" },
      { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "gpt-5-nano" },
    ],
  },
  construct: {
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
  oracle: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
  seraph: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
    ],
  },
  smith: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "medium" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
    ],
  },
  architect: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
  cipher: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["google-vertex-anthropic"], model: "claude-opus-4-6@default", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
}

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  construct: {
    fallbackChain: [
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      { providers: ["zai-coding-plan"], model: "glm-5" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  source: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "xhigh" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
    ],
  },
  "deep-jack": {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
    ],
    requiresModel: "gpt-5.3-codex",
  },
  "matrix-bend": {
    fallbackChain: [
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
    ],
    requiresModel: "gemini-3-pro",
  },
  "bullet-time": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
      { providers: ["opencode"], model: "gpt-5-nano" },
    ],
  },
  "blue-pill": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
    ],
  },
  "red-pill": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
  broadcast: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
    ],
  },
}
