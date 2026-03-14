import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig, OhMyOpenCodeConfig } from "../../config";
export interface AnthropicContextWindowLimitRecoveryOptions {
    experimental?: ExperimentalConfig;
    pluginConfig: OhMyOpenCodeConfig;
}
export declare function createAnthropicContextWindowLimitRecoveryHook(ctx: PluginInput, options?: AnthropicContextWindowLimitRecoveryOptions): {
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
};
