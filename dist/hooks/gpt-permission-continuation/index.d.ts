import type { PluginInput } from "@opencode-ai/plugin";
export type GptPermissionContinuationHook = {
    handler: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    wasRecentlyInjected: (sessionID: string) => boolean;
};
export declare function createGptPermissionContinuationHook(ctx: PluginInput, options?: {
    isContinuationStopped?: (sessionID: string) => boolean;
}): GptPermissionContinuationHook;
