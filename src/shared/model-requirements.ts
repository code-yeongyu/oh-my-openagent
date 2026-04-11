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
         providers: ["anthropic", "github-copilot", "opencode"],
         model: "claude-opus-4-6",
         variant: "max",
       },
       { providers: ["opencode-go"], model: "kimi-k2.5" },
       { providers: ["kimi-for-coding"], model: "k2p5" },
       {
         providers: [
           "opencode",
           "moonshotai",
           "moonshotai-cn",
           "firmware",
           "ollama-cloud",
           "aihubmix",
         ],
         model: "kimi-k2.5",
       },
       { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.4", variant: "medium" },
       { providers: ["zai-coding-plan", "opencode"], model: "glm-5" },
       { providers: ["opencode"], model: "big-pickle" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
     requiresAnyModel: true,
   },
   hephaestus: {
     fallbackChain: [
       {
         providers: ["openai", "github-copilot", "venice", "opencode"],
         model: "gpt-5.4",
         variant: "medium",
       },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
     requiresProvider: ["openai", "github-copilot", "venice", "opencode", "qwen"],
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
       { providers: ["opencode-go"], model: "glm-5" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   librarian: {
     fallbackChain: [
       { providers: ["opencode-go"], model: "minimax-m2.7" },
       { providers: ["opencode"], model: "minimax-m2.7-highspeed" },
       { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
       { providers: ["opencode"], model: "gpt-5-nano" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   explore: {
     fallbackChain: [
       { providers: ["github-copilot", "xai"], model: "grok-code-fast-1" },
       { providers: ["opencode-go"], model: "minimax-m2.7-highspeed" },
       { providers: ["opencode"], model: "minimax-m2.7" },
       { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
       { providers: ["opencode"], model: "gpt-5-nano" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   "multimodal-looker": {
     fallbackChain: [
       { providers: ["openai", "opencode"], model: "gpt-5.4", variant: "medium" },
       { providers: ["opencode-go"], model: "kimi-k2.5" },
       { providers: ["zai-coding-plan"], model: "glm-4.6v" },
       { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5-nano" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   prometheus: {
     fallbackChain: [
       {
         providers: ["anthropic", "github-copilot", "opencode"],
         model: "claude-opus-4-6",
         variant: "max",
       },
       {
         providers: ["openai", "github-copilot", "opencode"],
         model: "gpt-5.4",
         variant: "high",
       },
       { providers: ["opencode-go"], model: "glm-5" },
       {
         providers: ["google", "github-copilot", "opencode"],
         model: "gemini-3.1-pro",
       },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   metis: {
     fallbackChain: [
       {
         providers: ["anthropic", "github-copilot", "opencode"],
         model: "claude-opus-4-6",
         variant: "max",
       },
       {
         providers: ["openai", "github-copilot", "opencode"],
         model: "gpt-5.4",
         variant: "high",
       },
       { providers: ["opencode-go"], model: "glm-5" },
       { providers: ["kimi-for-coding"], model: "k2p5" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
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
       { providers: ["opencode-go"], model: "glm-5" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   atlas: {
     fallbackChain: [
       { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
       { providers: ["opencode-go"], model: "kimi-k2.5" },
       {
         providers: ["openai", "github-copilot", "opencode"],
         model: "gpt-5.4",
         variant: "medium",
       },
       { providers: ["opencode-go"], model: "minimax-m2.7" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   "sisyphus-junior": {
     fallbackChain: [
       { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
       { providers: ["opencode-go"], model: "kimi-k2.5" },
       {
         providers: ["openai", "github-copilot", "opencode"],
         model: "gpt-5.4",
         variant: "medium",
       },
       { providers: ["opencode-go"], model: "minimax-m2.7" },
       { providers: ["opencode"], model: "big-pickle" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
};

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
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
       { providers: ["opencode-go"], model: "glm-5" },
       { providers: ["kimi-for-coding"], model: "k2p5" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   ultrabrain: {
     fallbackChain: [
       {
         providers: ["openai", "opencode"],
         model: "gpt-5.4",
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
       { providers: ["opencode-go"], model: "glm-5" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   deep: {
     fallbackChain: [
       {
         providers: ["openai", "github-copilot", "venice", "opencode"],
         model: "gpt-5.4",
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
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
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
      { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.4" },
    ],
    requiresModel: "gemini-3.1-pro",
  },
   quick: {
     fallbackChain: [
       {
         providers: ["openai", "github-copilot", "opencode"],
         model: "gpt-5.4-mini",
       },
       {
         providers: ["anthropic", "github-copilot", "opencode"],
         model: "claude-haiku-4-5",
       },
       {
         providers: ["google", "github-copilot", "opencode"],
         model: "gemini-3-flash",
       },
       { providers: ["opencode-go"], model: "minimax-m2.7" },
       { providers: ["opencode"], model: "gpt-5-nano" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   "unspecified-low": {
     fallbackChain: [
       {
         providers: ["anthropic", "github-copilot", "opencode"],
         model: "claude-sonnet-4-6",
       },
       {
         providers: ["openai", "opencode"],
         model: "gpt-5.3-codex",
         variant: "medium",
       },
       { providers: ["opencode-go"], model: "kimi-k2.5" },
       {
         providers: ["google", "github-copilot", "opencode"],
         model: "gemini-3-flash",
       },
       { providers: ["opencode-go"], model: "minimax-m2.7" },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
   "unspecified-high": {
     fallbackChain: [
       {
         providers: ["anthropic", "github-copilot", "opencode"],
         model: "claude-opus-4-6",
         variant: "max",
       },
       {
         providers: ["openai", "github-copilot", "opencode"],
         model: "gpt-5.4",
         variant: "high",
       },
       { providers: ["zai-coding-plan", "opencode"], model: "glm-5" },
       { providers: ["kimi-for-coding"], model: "k2p5" },
       { providers: ["opencode-go"], model: "glm-5" },
       { providers: ["opencode"], model: "kimi-k2.5" },
       {
         providers: [
           "opencode",
           "moonshotai",
           "moonshotai-cn",
           "firmware",
           "ollama-cloud",
           "aihubmix",
         ],
         model: "kimi-k2.5",
       },
       { providers: ["qwen"], model: "qwen3-coder-next" },
     ],
   },
  writing: {
    fallbackChain: [
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-sonnet-4-6",
      },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
    ],
  },
};
