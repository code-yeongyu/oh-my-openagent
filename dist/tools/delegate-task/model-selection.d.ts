import type { FallbackEntry } from "../../shared/model-requirements";
export declare function resolveModelForDelegateTask(input: {
    userModel?: string;
    userFallbackModels?: string[];
    categoryDefaultModel?: string;
    fallbackChain?: FallbackEntry[];
    availableModels: Set<string>;
    systemDefaultModel?: string;
}): {
    model: string;
    variant?: string;
} | undefined;
