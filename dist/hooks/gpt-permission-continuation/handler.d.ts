import type { PluginInput } from "@opencode-ai/plugin";
import type { SessionStateStore } from "./session-state";
export declare function createGptPermissionContinuationHandler(args: {
    ctx: PluginInput;
    sessionStateStore: SessionStateStore;
    isContinuationStopped?: (sessionID: string) => boolean;
}): (input: {
    event: {
        type: string;
        properties?: unknown;
    };
}) => Promise<void>;
