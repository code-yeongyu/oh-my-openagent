import type { OhMyOpenCodeConfig } from "../config";
import type { ModelFallbackHook } from "../hooks/model-fallback/hook";
import type { PluginEventContext } from "./event-types";
export type FallbackContinuationContext = {
    agentName?: string;
    providerID?: string;
    dedupeProviderID?: string;
    modelID?: string;
};
type FallbackContinuationDedupeState = {
    modelKeys: Set<string>;
    providerModelKeys: Set<string>;
    providerlessModelKeys: Set<string>;
};
export declare function applyUserConfiguredFallbackChain(modelFallback: Pick<ModelFallbackHook, "setSessionFallbackChain"> | null | undefined, sessionID: string, agentName: string, currentProviderID: string, pluginConfig: OhMyOpenCodeConfig): void;
export declare function createModelFallbackContinuationController(args: {
    pluginConfig: OhMyOpenCodeConfig;
    pluginContext: PluginEventContext;
    lastKnownModelBySession: Map<string, {
        providerID: string;
        modelID: string;
    }>;
    continuationsInFlight: Set<string>;
    lastDispatchedContinuationKeys: Map<string, FallbackContinuationDedupeState>;
}): {
    autoContinueAfterFallback: (sessionID: string, source: string, fallbackContext?: FallbackContinuationContext) => Promise<void>;
    resolveFallbackProviderID: (sessionID: string, providerHint?: string) => string;
    shouldSkipFallbackContinuation: (sessionID: string, source: string, fallbackContext?: FallbackContinuationContext) => boolean;
};
export {};
