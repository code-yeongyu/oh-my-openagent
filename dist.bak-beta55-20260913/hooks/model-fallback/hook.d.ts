import type { FallbackEntry } from "../../shared/model-requirements";
import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message";
import { type ModelFallbackStateController } from "./fallback-state-controller";
import type { ModelFallbackControllerAccessor } from "./controller-accessor";
type FallbackToast = (input: {
    title: string;
    message: string;
    variant?: "info" | "success" | "warning" | "error";
    duration?: number;
}) => void | Promise<void>;
type FallbackCallback = (input: {
    sessionID: string;
    providerID: string;
    modelID: string;
    variant?: string;
}) => void | Promise<void>;
export type ModelFallbackState = {
    providerID: string;
    modelID: string;
    fallbackChain: FallbackEntry[];
    attemptCount: number;
    pending: boolean;
};
type ModelFallbackControllerWithState = Pick<ModelFallbackStateController, "lastToastKey" | "setSessionFallbackChain" | "getSessionFallbackChain" | "clearSessionFallbackChain" | "setPendingModelFallback" | "getNextFallback" | "clearPendingModelFallback" | "hasPendingModelFallback" | "getFallbackState" | "reset">;
export type ModelFallbackHook = ModelFallbackControllerWithState & {
    "chat.message": (input: ChatMessageInput, output: ChatMessageHandlerOutput) => Promise<void>;
};
type ModelFallbackHookArgs = {
    toast?: FallbackToast;
    onApplied?: FallbackCallback;
    controllerAccessor?: ModelFallbackControllerAccessor;
};
export declare function setSessionFallbackChain(controller: Pick<ModelFallbackStateController, "setSessionFallbackChain">, sessionID: string, fallbackChain: FallbackEntry[] | undefined): void;
export declare function getSessionFallbackChain(controller: Pick<ModelFallbackStateController, "getSessionFallbackChain">, sessionID: string): FallbackEntry[] | undefined;
export declare function clearSessionFallbackChain(controller: Pick<ModelFallbackStateController, "clearSessionFallbackChain">, sessionID: string): void;
/**
 * Sets a pending model fallback for a session.
 * Called when a model error is detected in session.error handler.
 */
export declare function setPendingModelFallback(controller: Pick<ModelFallbackStateController, "setPendingModelFallback">, sessionID: string, agentName: string, currentProviderID: string, currentModelID: string): boolean;
/**
 * Gets the next fallback model for a session.
 * Increments attemptCount each time called.
 */
export declare function getNextFallback(controller: Pick<ModelFallbackStateController, "getNextFallback">, sessionID: string): {
    providerID: string;
    modelID: string;
    variant?: string;
} | null;
/**
 * Clears the pending fallback for a session.
 * Called after fallback is successfully applied.
 */
export declare function clearPendingModelFallback(controller: Pick<ModelFallbackStateController, "clearPendingModelFallback">, sessionID: string): void;
/**
 * Checks if there's a pending fallback for a session.
 */
export declare function hasPendingModelFallback(controller: Pick<ModelFallbackStateController, "hasPendingModelFallback">, sessionID: string): boolean;
/**
 * Gets the current fallback state for a session (for debugging).
 */
export declare function getFallbackState(controller: Pick<ModelFallbackStateController, "getFallbackState">, sessionID: string): ModelFallbackState | undefined;
/**
 * Creates a chat.message hook that applies model fallbacks when pending.
 */
export declare function createModelFallbackHook(args?: ModelFallbackHookArgs): ModelFallbackHook;
/**
 * Resets hook-owned state for testing.
 */
export declare function _resetForTesting(controller?: Pick<ModelFallbackStateController, "reset">): void;
export {};
