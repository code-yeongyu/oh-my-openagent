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
      { providers: ["openrouter"], model: "deepseek/deepseek-v4-pro", variant: "max" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
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
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "medium" },
      { providers: ["zai-coding-plan", "opencode", "vercel"], model: "glm-5" },
      { providers: ["opencode"], model: "big-pickle" },
    ],
    requiresAnyModel: true,
  },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
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
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "medium" },
      { providers: ["zai-coding-plan", "opencode", "vercel"], model: "glm-5" },
      { providers: ["opencode"], model: "big-pickle" },
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      {
        providers: ["openai", "github-copilot", "venice", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
    ],
    requiresProvider: ["openai", "github-copilot", "venice", "opencode", "vercel"],
  },
  oracle: {
    fallbackChain: [
      { providers: ["openrouter"], model: "moonshotai/kimi-k2.6" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
    ],
  },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-flash" },
      { providers: ["openai"], model: "gpt-5.4-mini-fast" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7-highspeed" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["anthropic", "opencode", "vercel"], model: "claude-haiku-4-5" },
      { providers: ["openai", "opencode", "vercel"], model: "gpt-5.4-nano" },
    ],
  },
  explore: {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-flash" },
      { providers: ["openai"], model: "gpt-5.4-mini-fast" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7-highspeed" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["anthropic", "opencode", "vercel"], model: "claude-haiku-4-5" },
      { providers: ["openai", "opencode", "vercel"], model: "gpt-5.4-nano" },
    ],
  },
  explore: {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-flash" },
      { providers: ["openai"], model: "gpt-5.4-mini-fast" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7-highspeed" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["anthropic", "opencode", "vercel"], model: "claude-haiku-4-5" },
      { providers: ["openai", "opencode", "vercel"], model: "gpt-5.4-nano" },
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["openrouter"], model: "~google/gemini-flash-latest" },
      { providers: ["openai", "opencode", "vercel"], model: "gpt-5.5", variant: "medium" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
      { providers: ["zai-coding-plan", "vercel"], model: "glm-4.6v" },
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5-nano" },
    ],
  },
  prometheus: {
    fallbackChain: [
      { providers: ["openrouter"], model: "deepseek/deepseek-v4-pro", variant: "max" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
      },
    ],
  },
  metis: {
    fallbackChain: [
      { providers: ["openrouter"], model: "deepseek/deepseek-v4-pro", variant: "max" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  momus: {
    fallbackChain: [
      { providers: ["openrouter"], model: "deepseek/deepseek-v4-pro", reasoningEffort: "xhigh" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "xhigh",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["openrouter"], model: "xiaomi/mimo-v2.5-pro" },
      { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
      },
    ],
  },
  metis: {
    fallbackChain: [
      { providers: ["openrouter"], model: "deepseek/deepseek-v4-pro", variant: "max" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  momus: {
    fallbackChain: [
      { providers: ["openrouter"], model: "deepseek/deepseek-v4-pro", reasoningEffort: "xhigh" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "xhigh",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["openrouter"], model: "xiaomi/mimo-v2.5-pro" },
      { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
  "sisyphus-junior": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["opencode"], model: "big-pickle" },
    ],
  },
};

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      { providers: ["openrouter"], model: "~google/gemini-pro-latest" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "opencode", "vercel"], model: "glm-5" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["openrouter"], model: "openai/gpt-5.5", reasoningEffort: "xhigh" },
      {
        providers: ["openai", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "xhigh",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
    ],
  },
  deep: {
    fallbackChain: [
      {
        providers: ["openai", "github-copilot", "venice", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
    ],
  },
  artistry: {
    fallbackChain: [
      { providers: ["openrouter"], model: "google/gemini-3.1-pro-preview" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5" },
    ],
    requiresModel: "gemini-3.1-pro",
  },
  quick: {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-27b" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.4-mini",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-haiku-4-5",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["opencode", "vercel"], model: "gpt-5-nano" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-27b" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      {
        providers: ["openai", "opencode", "vercel"],
        model: "gpt-5.3-codex",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-plus" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "opencode", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
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
      { providers: ["openrouter"], model: "~google/gemini-pro-latest" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5" },
    ],
    requiresModel: "gemini-3.1-pro",
  },
  quick: {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-27b" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.4-mini",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-haiku-4-5",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["opencode", "vercel"], model: "gpt-5-nano" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-27b" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      {
        providers: ["openai", "opencode", "vercel"],
        model: "gpt-5.3-codex",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      { providers: ["openrouter"], model: "qwen/qwen3.6-plus" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "opencode", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode-go", "vercel"], model: "glm-5" },
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
      { providers: ["openrouter"], model: "~google/gemini-pro-latest" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.5" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
};
