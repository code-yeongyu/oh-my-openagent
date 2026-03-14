import type { PluginInput } from "@opencode-ai/plugin";
import type { AutoUpdateCheckerOptions } from "./types";
export declare function createAutoUpdateCheckerHook(ctx: PluginInput, options?: AutoUpdateCheckerOptions): {
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => void;
};
