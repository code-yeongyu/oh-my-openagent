import type { LoweredReasoning } from "./agent-variant";
type PromptParamModel = {
    providerID?: string;
    modelID?: string;
    runtimeModel?: Record<string, unknown>;
    temperature?: number;
    top_p?: number;
    reasoning?: string;
    reasoningEffort?: string;
    maxTokens?: number;
    thinking?: {
        type: "enabled" | "disabled";
        budgetTokens?: number;
    };
};
export declare function applySessionPromptParams(sessionID: string, model: PromptParamModel | undefined): LoweredReasoning;
export {};
