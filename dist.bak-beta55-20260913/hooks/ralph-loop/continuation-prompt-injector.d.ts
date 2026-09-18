import type { PluginInput } from "@opencode-ai/plugin";
export type ContinuationPromptResult = {
    status: "dispatched";
} | {
    status: "deferred";
    reason: "active" | "reserved";
} | {
    status: "rejected";
    error: Error;
};
export declare function injectContinuationPrompt(ctx: PluginInput, options: {
    sessionID: string;
    prompt: string;
    directory: string;
    apiTimeoutMs: number;
    inheritFromSessionID?: string;
    idleSettleMs?: number;
}): Promise<ContinuationPromptResult>;
