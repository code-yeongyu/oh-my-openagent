import type { OhMyOpenCodeConfig } from "../config";
import { type ModelFallbackHook } from "../hooks/model-fallback/hook";
import type { PluginEventContext } from "./event-types";
export declare function createModelFallbackEventHandler(args: {
    pluginConfig: OhMyOpenCodeConfig;
    pluginContext: PluginEventContext;
    modelFallback: ModelFallbackHook | null | undefined;
    isModelFallbackEnabled: boolean;
    isRuntimeFallbackEnabled: boolean;
    shouldAutoRetrySession: (sessionID: string) => boolean;
    isSessionStopped: (sessionID: string) => boolean;
}): {
    clearRetryDedupeAfterIdle: (sessionID: string) => void;
    clearSession: (sessionID: string) => void;
    handleAssistantMessageUpdated: (params: {
        sessionID: string;
        info: Record<string, unknown>;
        agent?: string;
    }) => Promise<boolean>;
    handleSessionError: (params: {
        sessionID: string;
        errorMessage: string;
        errorName?: string;
        props?: Record<string, unknown>;
    }) => Promise<void>;
    handleSessionStatus: (params: {
        sessionID: string;
        status?: {
            type?: string;
            attempt?: number;
            message?: string;
            next?: number;
        };
    }) => Promise<boolean>;
    setLastKnownModel: (sessionID: string, model: {
        providerID: string;
        modelID: string;
    }) => void;
};
