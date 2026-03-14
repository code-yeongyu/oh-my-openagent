import type { createOpencodeClient } from "@opencode-ai/sdk";
import { type PromptRetryOptions } from "./prompt-timeout-context";
type Client = ReturnType<typeof createOpencodeClient>;
export interface ModelSuggestionInfo {
    providerID: string;
    modelID: string;
    suggestion: string;
}
export declare function parseModelSuggestion(error: unknown): ModelSuggestionInfo | null;
interface PromptBody {
    model?: {
        providerID: string;
        modelID: string;
    };
    [key: string]: unknown;
}
interface PromptArgs {
    path: {
        id: string;
    };
    body: PromptBody;
    signal?: AbortSignal;
    [key: string]: unknown;
}
export declare function promptWithModelSuggestionRetry(client: Client, args: PromptArgs, options?: PromptRetryOptions): Promise<void>;
/**
 * Synchronous variant of promptWithModelSuggestionRetry.
 *
 * Uses `session.prompt` (blocking HTTP call that waits for the LLM response)
 * instead of `promptAsync` (fire-and-forget HTTP 204).
 *
 * Required by callers that need the response to be available immediately after
 * the call returns — e.g. look_at, which reads session messages right away.
 */
export declare function promptSyncWithModelSuggestionRetry(client: Client, args: PromptArgs, options?: PromptRetryOptions): Promise<void>;
export {};
