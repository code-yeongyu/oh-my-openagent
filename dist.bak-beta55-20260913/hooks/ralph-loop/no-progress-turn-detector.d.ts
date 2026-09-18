import type { PluginInput } from "@opencode-ai/plugin";
export declare function latestAssistantTurnMadeNoProgress(ctx: PluginInput, input: {
    readonly sessionID: string;
    readonly directory: string;
    readonly apiTimeoutMs: number;
    readonly sinceMessageIndex?: number;
}): Promise<boolean>;
