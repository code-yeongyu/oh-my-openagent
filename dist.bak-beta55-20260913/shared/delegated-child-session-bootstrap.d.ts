import type { ModelFallbackControllerAccessor } from "../hooks/model-fallback";
import type { FallbackEntry } from "./model-requirements";
export type DelegatedChildSessionRetryPart = {
    type: "text";
    text: string;
};
export type DelegatedChildSessionBootstrap = {
    retryParts: DelegatedChildSessionRetryPart[];
    fallbackChain?: FallbackEntry[];
    category?: string;
    system?: string;
    tools?: Record<string, boolean>;
};
export declare function registerDelegatedChildSessionBootstrap(_args: {
    sessionID: string;
    promptText: string;
    fallbackChain?: FallbackEntry[];
    category?: string;
    system?: string;
    tools?: Record<string, boolean>;
    modelFallbackControllerAccessor?: ModelFallbackControllerAccessor;
}): void;
export declare function getDelegatedChildSessionBootstrap(_sessionID: string): DelegatedChildSessionBootstrap | undefined;
export declare function clearDelegatedChildSessionBootstrap(_sessionID: string): void;
export declare function clearAllDelegatedChildSessionBootstrap(): void;
