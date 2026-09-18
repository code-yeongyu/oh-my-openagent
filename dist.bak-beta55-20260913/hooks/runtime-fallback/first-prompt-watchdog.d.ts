import type { HookDeps } from "./types";
import type { AutoRetryHelpers } from "./auto-retry";
export interface FirstPromptWatchdog {
    onUserMessage(sessionID: string, model?: string, agent?: string): void;
    onAssistantProgress(sessionID: string): void;
    onSessionTerminal(sessionID: string): void;
    dispose(): void;
}
/**
 * Translate an OpenCode session event into the appropriate watchdog signal.
 *
 * Progress semantics for cancelling the watchdog:
 *   - assistant `info.error` set: the existing message-update-handler will
 *     deal with the error path; the watchdog has done its job.
 *   - assistant `info.finish` set: the response completed.
 *   - any assistant part with a known type (`text`, `reasoning`, `tool`,
 *     `tool_use`, `tool_result`, `tool-call`, `step-start`, `file`, ...):
 *     the model has started responding. A subagent that immediately runs
 *     tools is *working*, not silent — so any part presence cancels.
 */
export declare function observeEventForWatchdog(event: {
    type: string;
    properties?: unknown;
}, watchdog: FirstPromptWatchdog): void;
export declare function createFirstPromptWatchdog(deps: HookDeps, helpers: AutoRetryHelpers, watchdogMs?: number): FirstPromptWatchdog;
