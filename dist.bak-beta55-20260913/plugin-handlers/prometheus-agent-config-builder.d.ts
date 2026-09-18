import type { CategoryConfig } from "../config/schema";
import type { FallbackModels } from "../config/schema/fallback-models";
type PrometheusOverride = Record<string, unknown> & {
    category?: string;
    model?: string;
    reasoning?: string;
    variant?: string;
    reasoningEffort?: string;
    textVerbosity?: string;
    thinking?: {
        type: string;
        budgetTokens?: number;
    };
    temperature?: number;
    top_p?: number;
    maxTokens?: number;
    fallback_models?: FallbackModels;
    prompt?: string;
    prompt_append?: string;
};
export declare function buildPrometheusAgentConfig(params: {
    configAgentPlan: Record<string, unknown> | undefined;
    pluginPrometheusOverride: PrometheusOverride | undefined;
    userCategories: Record<string, CategoryConfig> | undefined;
    currentModel: string | undefined;
    disabledTools?: readonly string[];
}): Promise<Record<string, unknown>>;
export {};
