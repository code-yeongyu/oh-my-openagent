/**
 * Centralized registry for supported providers and model strings.
 * Use these constants instead of magic string literals to prevent typos
 * and facilitate future model deprecations.
 */

export const SUPPORTED_PROVIDERS = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
  GOOGLE_VERTEX: "google-vertex",
  GITHUB_COPILOT: "github-copilot",
  LITELLM: "litellm",
  OPENROUTER: "openrouter",
  VERCEL: "vercel",
  OPENCODE: "opencode",
  OPENCODE_GO: "opencode-go",
  OLLAMA: "ollama",
  OLLAMA_CLOUD: "ollama-cloud",
  AZURE: "azure",
  KIMI_FOR_CODING: "kimi-for-coding",
  BAILIAN_CODING_PLAN: "bailian-coding-plan",
  MOONSHOTAI: "moonshotai",
  MOONSHOTAI_CN: "moonshotai-cn",
  FIRMWARE: "firmware",
  ZAI_CODING_PLAN: "zai-coding-plan",
  VENICE: "venice",
  MINIMAX_CODING_PLAN: "minimax-coding-plan",
  MINIMAX_CN_CODING_PLAN: "minimax-cn-coding-plan",
  AIHUBMIX: "aihubmix",
  VOLCENGINE: "volcengine",
  AZURE_OPENAI: "azure-openai",
  OPENAI_COMPATIBLE: "openai-compatible",
  XAI: "xai",
  MINIMAX: "minimax",
  ZAI: "zai",
  GOOGLE_VERTEX_ANTHROPIC: "google-vertex-anthropic",
  AWS_BEDROCK_ANTHROPIC: "aws-bedrock-anthropic",
  NVIDIA: "nvidia",
  MYSTERY: "mystery",
  PROVIDER_X: "provider-x",
  PROVIDER_Y: "provider-y",
  Z_AI: "z-ai",
  UNKNOWN: "unknown",
} as const;

export type Provider = typeof SUPPORTED_PROVIDERS[keyof typeof SUPPORTED_PROVIDERS] | (string & {});

export const SUPPORTED_MODELS = {
  // OpenAI
  GPT_5_6_SOL: "gpt-5.6-sol",
  GPT_5_6_TERRA: "gpt-5.6-terra",
  GPT_5_6_LUNA: "gpt-5.6-luna",
  GPT_5_6: "gpt-5.6",
  GPT_5_5: "gpt-5.5",
  GPT_5_4: "gpt-5.4",
  GPT_5_4_MINI: "gpt-5.4-mini",
  GPT_5_4_MINI_FAST: "gpt-5.4-mini-fast",
  GPT_5_4_NANO: "gpt-5.4-nano",
  GPT_5_NANO: "gpt-5-nano",
  GPT_4O: "gpt-4o",
  GPT_4O_MINI: "gpt-4o-mini",
  O3_MINI: "o3-mini",
  OPENAI_O3_MINI: "openai/o3-mini",
  OPENAI_GPT_5_5: "openai/gpt-5.5",
  GITHUB_COPILOT_GPT_4O: "github-copilot/gpt-4o",

  // Anthropic
  CLAUDE_OPUS_4_8: "claude-opus-4-8",
  CLAUDE_OPUS_4_7: "claude-opus-4-7",
  CLAUDE_OPUS_4_7_THINKING: "anthropic/claude-opus-4-7-thinking",
  CLAUDE_SONNET_4_6: "claude-sonnet-4-6",
  CLAUDE_SONNET_5_1: "claude-sonnet-5-1",
  CLAUDE_HAIKU_4_5: "claude-haiku-4-5",
  CLAUDE_FABLE_5: "claude-fable-5",
  ANTHROPIC_CLAUDE_OPUS_4_6: "anthropic/claude-opus-4-6",
  ANTHROPIC_CLAUDE_OPUS_4_6_ALT: "anthropic/claude-opus-4.6",
  CLAUDE_OPUS_4_6: "claude-opus-4-6",
  ANTHROPIC_CLAUDE_OPUS_4_7: "anthropic/claude-opus-4-7",
  ANTHROPIC_CLAUDE_OPUS_4_7_ALT: "anthropic/claude-opus-4.7",
  ANTHROPIC_CLAUDE_SONNET_4_6: "anthropic/claude-sonnet-4-6",
  ANTHROPIC_CLAUDE_OPUS_4_8: "anthropic/claude-opus-4-8",
  ANTHROPIC_CLAUDE_OPUS_4_8_ALT: "anthropic/claude-opus-4.8",
  ANTHROPIC_CLAUDE_FABLE_5: "anthropic/claude-fable-5",
  ANTHROPIC_CLAUDE_FABLE_5_1M: "anthropic/claude-fable-5[1m]",
  ANTHROPIC_CLAUDE_OPUS_5_0: "anthropic/claude-opus-5-0",

  // Google
  GEMINI_3_1_PRO: "gemini-3.1-pro",
  GEMINI_3_FLASH: "gemini-3-flash",
  GOOGLE_GEMINI_3_1_PRO: "google/gemini-3.1-pro",
  GOOGLE_VERTEX_GEMINI_3_FLASH: "google-vertex/gemini-3-flash",
  GITHUB_COPILOT_GEMINI_3_1_PRO: "github-copilot/gemini-3.1-pro",

  // Z.ai / OP / Kimi
  GLM_5_2: "glm-5.2",
  GLM_5_1: "glm-5.1",
  GLM_5: "glm-5",
  GLM_4_6V: "glm-4.6v",
  KIMI_K2_6: "kimi-k2.6",
  KIMI_K2_6_THINKING: "kimi-k2.6-thinking",
  KIMI_K2_5: "kimi-k2.5",
  KIMI_K2P5: "k2p5",
  KIMI_P6: "kimi-p6",
  Z_AI_GLM_5_1: "z-ai/glm-5.1",
  OPENCODE_GLM_4_6V: "opencode/glm-4.6v",
  MOONSHOTAI_KIMI_K2_6: "moonshotai/kimi-k2.6",
  OPENCODE_K2P5: "opencode/k2p5",
  OPENCODE_K2_P6: "opencode/k2-p6",
  OPENCODE_GO_KIMI_K2_7: "opencode-go/kimi-k2.7",
  MOONSHOTAI_KIMI_K2_7: "moonshotai/kimi-k2-7",
  KIMI_FOR_CODING_K2P7: "kimi-for-coding/k2p7",
  OPENCODE_K2_P7: "opencode/k2-p7",
  OPENCODE_GO_KIMI_K2_6: "opencode-go/kimi-k2.6",
  KIMI_FOR_CODING_K2P6: "kimi-for-coding/k2p6",
  KIMI_FOR_CODING_K2P5: "kimi-for-coding/k2p5",

  // Qwen
  QWEN_3_5_PLUS: "qwen3.5-plus",

  // Minimax
  MINIMAX_M2_7_HIGHSPEED: "minimax-m2.7-highspeed",
  MINIMAX_M3: "minimax-m3",
  MINIMAX_M3_CAP: "MiniMax-M3",
  MINIMAX_M2_7: "minimax-m2.7",
  OPENCODE_MINIMAX_M2_7: "opencode/minimax-m2.7",

  // Custom
  BIG_PICKLE: "big-pickle",
  DEEPSEEK_V4_PRO: "deepseek-v4-pro",
  MYSTERY_MODEL_1: "mystery-model-1",
  NVIDIA_STEPFUN_AI_STEP_3_5_FLASH: "nvidia/stepfun-ai/step-3.5-flash",
} as const;

export type SupportedModel = typeof SUPPORTED_MODELS[keyof typeof SUPPORTED_MODELS] | (string & {});

export const SUPPORTED_REASONING_EFFORTS = {
  NONE: "none",
  MINIMAL: "minimal",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
  MAX: "max",
} as const;

export type ReasoningEffort = typeof SUPPORTED_REASONING_EFFORTS[keyof typeof SUPPORTED_REASONING_EFFORTS];

export const SUPPORTED_VARIANTS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
  MAX: "max",
  AUTO: "auto",
  THINKING: "thinking",
  MINIMAL: "minimal",
  NONE: "none",
} as const;

export type Variant = typeof SUPPORTED_VARIANTS[keyof typeof SUPPORTED_VARIANTS];

/**
 * Core attributes shared by both internal model fallbacks and external configuration settings.
 */
export interface ModelAttributes {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

export interface ThinkingConfig {
  readonly type: "enabled" | "disabled";
  readonly budgetTokens?: number;
}

/**
 * Standardized configuration payload for model execution options.
 */
export interface ModelSettings extends ModelAttributes {
  variant?: Variant;
  thinking?: boolean | ThinkingConfig;
}
