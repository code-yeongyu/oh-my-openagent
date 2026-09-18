import type { SisyphusAgentConfig } from "../../config/schema";
import { promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry";
import type { DelegatedModelConfig, DelegateTaskArgs, OpencodeClient } from "./types";
type SendSyncPromptDeps = {
    promptWithModelSuggestionRetry: typeof promptWithModelSuggestionRetry;
};
export declare function buildSyncPromptTools(agentToUse: string, permission?: Record<string, "ask" | "allow" | "deny">): Record<string, boolean>;
export declare function sendSyncPrompt(client: OpencodeClient, input: {
    sessionID: string;
    agentToUse: string;
    args: DelegateTaskArgs;
    systemContent: string | undefined;
    categoryModel: DelegatedModelConfig | undefined;
    directory: string;
    toastManager: {
        removeTask: (id: string) => void;
    } | null | undefined;
    taskId: string | undefined;
    sisyphusAgentConfig?: SisyphusAgentConfig;
}, deps?: SendSyncPromptDeps): Promise<string | null>;
export {};
