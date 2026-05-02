export type FallbackEntry = {
  providers: string[];
  model: string;
  variant?: string; // Entry-specific variant (e.g., GPT→high, Opus→max)
  reasoningEffort?: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
};

export type ModelRequirement = {
  fallbackChain: FallbackEntry[];
  variant?: string; // Default variant (used when entry doesn't specify one)
  requiresModel?: string; // If set, only activates when this model is available (fuzzy match)
  requiresAnyModel?: boolean; // If true, requires at least ONE model in fallbackChain to be available (or empty availability treated as unavailable)
  requiresProvider?: string[]; // If set, only activates when any of these providers is connected
};

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "kimi-k2.5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      {
        providers: [
          "opencode",
          "moonshotai",
          "moonshotai-cn",
          "firmware",
          "ollama-cloud",
          "aihubmix",
          "vercel",
        ],
        model: "kimi-k2.5",
      },
      { providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "medium" },
      { providers: ["zai-coding-plan", "openrouter", "opencode", "vercel"], model: "glm-5" },
      { providers: ["opencode"], model: "big-pickle" },
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      {
        providers: ["openai", "openrouter", "github-copilot", "venice", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
    ],
    requiresProvider: ["openai", "openrouter", "github-copilot", "venice", "opencode", "vercel"],
  },
  oracle: {
    fallbackChain: [
      {
        providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "glm-5" },
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["openai", "openrouter"], model: "gpt-5.4-mini-fast" },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7-highspeed" },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7" },
      { providers: ["anthropic", "openrouter", "opencode", "vercel"], model: "claude-haiku-4-5" },
      { providers: ["openai", "openrouter", "opencode", "vercel"], model: "gpt-5.4-nano" },
    ],
  },
  explore: {
    fallbackChain: [
      { providers: ["openai", "openrouter"], model: "gpt-5.4-mini-fast" },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7-highspeed" },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7" },
      { providers: ["anthropic", "openrouter", "opencode", "vercel"], model: "claude-haiku-4-5" },
      { providers: ["openai", "openrouter", "opencode", "vercel"], model: "gpt-5.4-nano" },
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["openai", "openrouter", "opencode", "vercel"], model: "gpt-5.5", variant: "medium" },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "kimi-k2.5" },
      { providers: ["zai-coding-plan", "openrouter", "vercel"], model: "glm-4.6v" },
      { providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"], model: "gpt-5-nano" },
    ],
  },
  prometheus: {
    fallbackChain: [
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "glm-5" },
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
      },
    ],
  },
  metis: {
    fallbackChain: [
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  momus: {
    fallbackChain: [
      {
        providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "xhigh",
      },
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "glm-5" },
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7" },
    ],
  },
  "sisyphus-junior": {
    fallbackChain: [
      { providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7" },
      { providers: ["opencode"], model: "big-pickle" },
    ],
  },
};

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "openrouter", "opencode", "vercel"], model: "glm-5" },
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      {
        providers: ["openai", "openrouter", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "xhigh",
      },
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "glm-5" },
    ],
  },
  deep: {
    fallbackChain: [
      {
        providers: ["openai", "openrouter", "github-copilot", "venice", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
    ],
  },
  artistry: {
    fallbackChain: [
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"], model: "gpt-5.5" },
    ],
  },
  quick: {
    fallbackChain: [
      {
        providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.4-mini",
      },
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-haiku-4-5",
      },
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7" },
      { providers: ["opencode", "vercel"], model: "gpt-5-nano" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      {
        providers: ["openai", "openrouter", "opencode", "vercel"],
        model: "gpt-5.3-codex",
        variant: "medium",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "openrouter", "opencode", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "glm-5" },
      { providers: ["opencode", "vercel"], model: "kimi-k2.5" },
      {
        providers: [
          "opencode",
          "moonshotai",
          "moonshotai-cn",
          "firmware",
          "ollama-cloud",
          "aihubmix",
          "vercel",
        ],
        model: "kimi-k2.5",
      },
    ],
  },
  writing: {
    fallbackChain: [
      {
        providers: ["google", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["anthropic", "openrouter", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      { providers: ["opencode-go", "openrouter", "vercel"], model: "minimax-m2.7" },
    ],
  },
};
