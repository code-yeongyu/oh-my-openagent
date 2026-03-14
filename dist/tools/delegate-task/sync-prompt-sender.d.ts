import type { DelegateTaskArgs, OpencodeClient } from "./types";
import { promptSyncWithModelSuggestionRetry, promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry";
type SendSyncPromptDeps = {
    promptWithModelSuggestionRetry: typeof promptWithModelSuggestionRetry;
    promptSyncWithModelSuggestionRetry: typeof promptSyncWithModelSuggestionRetry;
};
export declare function sendSyncPrompt(client: OpencodeClient, input: {
    sessionID: string;
    agentToUse: string;
    args: DelegateTaskArgs;
    systemContent: string | undefined;
    categoryModel: {
        providerID: string;
        modelID: string;
        variant?: string;
    } | undefined;
    toastManager: {
        removeTask: (id: string) => void;
    } | null | undefined;
    taskId: string | undefined;
}, deps?: SendSyncPromptDeps): Promise<string | null>;
export {};
