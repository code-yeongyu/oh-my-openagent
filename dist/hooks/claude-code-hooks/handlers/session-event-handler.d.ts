import type { PluginInput } from "@opencode-ai/plugin";
import type { PluginConfig } from "../types";
export declare function createSessionEventHandler(ctx: PluginInput, config: PluginConfig): (input: {
    event: {
        type: string;
        properties?: unknown;
    };
}) => Promise<void>;
