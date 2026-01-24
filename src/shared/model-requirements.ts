export type FallbackEntry = {
  providers: string[]
  model: string
  variant?: string // Entry-specific variant (e.g., GPT→high, Opus→max)
}

export type ModelRequirement = {
  fallbackChain: FallbackEntry[]
  variant?: string // Default variant (used when entry doesn't specify one)
}

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
      { providers: ["zai-coding-plan"], model: "glm-4.7" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2-codex", variant: "medium" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
  oracle: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
   librarian: {
     fallbackChain: [
       { providers: ["zai-coding-plan"], model: "glm-4.7" },
       { providers: ["opencode"], model: "big-pickle" },
       { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
     ],
   },
  explore: {
    fallbackChain: [
      { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "gpt-5-nano" },
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
      { providers: ["zai-coding-plan"], model: "glm-4.6v" },
      { providers: ["opencode"], model: "gpt-5-nano" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
    ],
  },
  prometheus: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
  metis: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "max" },
    ],
  },
  momus: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "medium" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "max" },
    ],
  },
  atlas: {
    fallbackChain: [
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
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2-codex", variant: "xhigh" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
    ],
  },
  artistry: {
    fallbackChain: [
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "max" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
    ],
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
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2-codex", variant: "medium" },
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
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
