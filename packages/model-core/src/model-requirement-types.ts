import type { Provider, SupportedModel, Variant, ReasoningEffort, ThinkingConfig } from "./registry";

export type FallbackEntry = {
  providers: Provider[];
  model: SupportedModel;
  variant?: Variant; // Entry-specific variant (e.g., GPT->high, Opus->max)
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  thinking?: ThinkingConfig;
};

export type ModelRequirement = {
  fallbackChain: FallbackEntry[];
  variant?: Variant; // Default variant (used when entry doesn't specify one)
  requiresModel?: string; // If set, only activates when this model is available (fuzzy match)
  requiresAnyModel?: boolean; // If true, requires at least ONE model in fallbackChain to be available (or empty availability treated as unavailable)
  requiresProvider?: Provider[]; // If set, only activates when any of these providers is connected
};
