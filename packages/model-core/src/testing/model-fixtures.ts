import { SUPPORTED_PROVIDERS as P } from "../registry";

/** Fake providers for testing — NOT part of the public API. */
export const TEST_PROVIDERS = {
  MYSTERY: "mystery",
  PROVIDER_X: "provider-x",
  PROVIDER_Y: "provider-y",
  UNKNOWN: "unknown",
} as const;

/** Fake models for testing. */
export const TEST_MODELS = {
  MYSTERY_MODEL_1: "mystery-model-1",
  DEEPSEEK_V4_PRO: "deepseek-v4-pro",
} as const;

/** Provider-qualified model IDs for tests (alt-format variants, special suffixes, etc.) */
export const TEST_QUALIFIED = {
  ANTHROPIC_CLAUDE_OPUS_4_6_ALT: `${P.ANTHROPIC}/claude-opus-4.6`,
  ANTHROPIC_CLAUDE_OPUS_4_7_ALT: `${P.ANTHROPIC}/claude-opus-4.7`,
  ANTHROPIC_CLAUDE_OPUS_4_8_ALT: `${P.ANTHROPIC}/claude-opus-4.8`,
  ANTHROPIC_CLAUDE_FABLE_5_1M: `${P.ANTHROPIC}/claude-fable-5[1m]`,
  ANTHROPIC_CLAUDE_OPUS_5_0: `${P.ANTHROPIC}/claude-opus-5-0`,
  NVIDIA_STEPFUN: "nvidia/stepfun-ai/step-3.5-flash",
} as const;
