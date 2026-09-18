import { parseModelSuggestion as parseModelSuggestionFromCore } from "@oh-my-opencode/model-core";
import type { SessionPromptAsyncData, SessionPromptData } from "@opencode-ai/sdk";
import { type PromptRetryOptions } from "./prompt-timeout-context";
export type { ModelSuggestionInfo } from "@oh-my-opencode/model-core";
export { parseModelSuggestionFromCore as parseModelSuggestion };
type PromptAsyncArgs = Omit<SessionPromptAsyncData, "url" | "body"> & {
    readonly body: NonNullable<SessionPromptAsyncData["body"]>;
    readonly signal?: AbortSignal;
};
type PromptSyncArgs = Omit<SessionPromptData, "url" | "body"> & {
    readonly body: NonNullable<SessionPromptData["body"]>;
    readonly signal?: AbortSignal;
};
type PromptAsyncRetryClient = {
    readonly session?: {
        readonly status?: () => Promise<unknown>;
        readonly messages?: (input: {
            readonly path: {
                readonly id: string;
            };
            readonly query: {
                readonly directory: string;
                readonly limit?: number;
            };
        }) => Promise<unknown>;
        promptAsync?(input: PromptAsyncArgs): Promise<unknown>;
    };
};
type PromptSyncRetryClient = {
    readonly session?: {
        readonly status?: () => Promise<unknown>;
        readonly messages?: (input: {
            readonly path: {
                readonly id: string;
            };
            readonly query: {
                readonly directory: string;
                readonly limit?: number;
            };
        }) => Promise<unknown>;
        prompt?(input: PromptSyncArgs): Promise<unknown>;
    };
};
export declare function promptWithModelSuggestionRetry(client: PromptAsyncRetryClient, args: PromptAsyncArgs, options?: PromptRetryOptions): Promise<void>;
export declare function promptSyncWithModelSuggestionRetry(client: PromptSyncRetryClient, args: PromptSyncArgs, options?: PromptRetryOptions): Promise<void>;
