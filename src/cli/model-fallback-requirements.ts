import type { ModelRequirement } from "../shared/model-requirements";

// NOTE: These requirements are used by the CLI config generator (`generateModelConfig`).
// They intentionally use "install-time" provider IDs (anthropic/openai/google/opencode/etc),
// not runtime-only providers like `nvidia`.

export const CLI_AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["zai-coding-plan", "opencode"], model: "glm-5" },
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      {
        providers: ["openai", "opencode"],
        model: "gpt-5.3-codex",
        variant: "medium",
      },
    ],
    requiresProvider: ["openai", "opencode"],
  },
  oracle: {
    fallbackChain: [
      {
        providers: ["openai", "github-copilot", "opencode"],
        model: "gpt-5.4",
        variant: "high",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      },
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["zai-coding-plan"], model: "glm-4.7" },
      { providers: ["opencode"], model: "glm-4.7-free" },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-sonnet-4-5",
      },
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
      {
        providers: ["openai", "opencode"],
        model: "gpt-5.3-codex",
        variant: "medium",
      },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3-flash",
      },
      { providers: ["zai-coding-plan"], model: "glm-4.6v" },
      { providers: ["opencode"], model: "gpt-5-nano" },
    ],
  },
  prometheus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      {
        providers: ["openai", "github-copilot", "opencode"],
        model: "gpt-5.4",
        variant: "high",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
      },
    ],
  },
  metis: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      {
        providers: ["openai", "github-copilot", "opencode"],
        model: "gpt-5.4",
        variant: "high",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
    ],
  },
  momus: {
    fallbackChain: [
      {
        providers: ["openai", "github-copilot", "opencode"],
        model: "gpt-5.4",
        variant: "xhigh",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "k2p5" },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-sonnet-4-5",
      },
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.4", variant: "medium" },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
      },
    ],
  },
};

export const CLI_CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> =
  {
    "visual-engineering": {
      fallbackChain: [
        {
          providers: ["google", "github-copilot", "opencode"],
          model: "gemini-3.1-pro",
          variant: "high",
        },
        { providers: ["zai-coding-plan", "opencode"], model: "glm-5" },
        {
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-4-6",
          variant: "max",
        },
        { providers: ["kimi-for-coding"], model: "k2p5" },
      ],
    },
    ultrabrain: {
      fallbackChain: [
        {
          providers: ["openai", "opencode"],
          model: "gpt-5.3-codex",
          variant: "xhigh",
        },
        {
          providers: ["google", "github-copilot", "opencode"],
          model: "gemini-3.1-pro",
          variant: "high",
        },
        {
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-4-6",
          variant: "max",
        },
      ],
    },
    deep: {
      fallbackChain: [
        {
          providers: ["openai", "opencode"],
          model: "gpt-5.3-codex",
          variant: "medium",
        },
        {
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-4-6",
          variant: "max",
        },
        {
          providers: ["google", "github-copilot", "opencode"],
          model: "gemini-3.1-pro",
          variant: "high",
        },
      ],
      requiresModel: "gpt-5.3-codex",
    },
    artistry: {
      fallbackChain: [
        {
          providers: ["google", "github-copilot", "opencode"],
          model: "gemini-3.1-pro",
          variant: "high",
        },
        {
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-4-6",
          variant: "max",
        },
        {
          providers: ["openai", "github-copilot", "opencode"],
          model: "gpt-5.4",
        },
      ],
      requiresModel: "gemini-3.1-pro",
    },
    quick: {
      fallbackChain: [
        {
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-haiku-4-5",
        },
        {
          providers: ["google", "github-copilot", "opencode"],
          model: "gemini-3-flash",
        },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    "unspecified-low": {
      fallbackChain: [
        {
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-sonnet-4-5",
        },
        {
          providers: ["openai", "opencode"],
          model: "gpt-5.3-codex",
          variant: "medium",
        },
        {
          providers: ["google", "github-copilot", "opencode"],
          model: "gemini-3-flash",
        },
      ],
    },
    "unspecified-high": {
      fallbackChain: [
        {
          providers: ["openai", "github-copilot", "opencode"],
          model: "gpt-5.4",
          variant: "high",
        },
        {
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-4-6",
          variant: "max",
        },
        { providers: ["zai-coding-plan", "opencode"], model: "glm-5" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5" },
      ],
    },
    writing: {
      fallbackChain: [
        { providers: ["kimi-for-coding"], model: "k2p5" },
        {
          providers: ["google", "github-copilot", "opencode"],
          model: "gemini-3-flash",
        },
        {
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-sonnet-4-5",
        },
      ],
    },
  };
