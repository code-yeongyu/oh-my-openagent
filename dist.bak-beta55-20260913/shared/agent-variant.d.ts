import type { GetModelCapabilitiesInput } from "@oh-my-opencode/model-core";
import type { OhMyOpenCodeConfig } from "../config";
type OpenCodeReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type LoweredReasoning = {
    variant?: string;
    reasoningEffort?: OpenCodeReasoningEffort;
};
export declare function lowerReasoningForModel(reasoning: string | undefined, model: GetModelCapabilitiesInput): LoweredReasoning;
export declare function resolveAgentVariant(config: OhMyOpenCodeConfig, agentName?: string): string | undefined;
export declare function resolveVariantForModel(config: OhMyOpenCodeConfig, agentName: string, currentModel: {
    providerID: string;
    modelID: string;
}): string | undefined;
export declare function applyAgentVariant(config: OhMyOpenCodeConfig, agentName: string | undefined, message: {
    variant?: string;
}, currentModel: {
    providerID: string;
    modelID: string;
}): void;
export {};
