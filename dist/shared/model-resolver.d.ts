import type { FallbackEntry } from "./model-requirements";
export type ModelResolutionInput = {
    userModel?: string;
    inheritedModel?: string;
    systemDefault?: string;
};
export type ModelSource = "override" | "category-default" | "provider-fallback" | "system-default";
export type ModelResolutionResult = {
    model: string;
    source: ModelSource;
    variant?: string;
};
export type ExtendedModelResolutionInput = {
    uiSelectedModel?: string;
    userModel?: string;
    userFallbackModels?: string[];
    categoryDefaultModel?: string;
    fallbackChain?: FallbackEntry[];
    availableModels: Set<string>;
    systemDefaultModel?: string;
};
export declare function resolveModel(input: ModelResolutionInput): string | undefined;
export declare function resolveModelWithFallback(input: ExtendedModelResolutionInput): ModelResolutionResult | undefined;
/**
 * Normalizes fallback_models config (which can be string or string[]) to string[]
 * Centralized helper to avoid duplicated normalization logic
 */
export declare function normalizeFallbackModels(models: string | string[] | undefined): string[] | undefined;
