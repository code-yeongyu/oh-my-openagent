export type FallbackEntry = {
    providers: string[];
    model: string;
    variant?: string;
};
export type ModelRequirement = {
    fallbackChain: FallbackEntry[];
    variant?: string;
    requiresModel?: string;
    requiresAnyModel?: boolean;
    requiresProvider?: string[];
};
export declare const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement>;
export declare const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement>;
