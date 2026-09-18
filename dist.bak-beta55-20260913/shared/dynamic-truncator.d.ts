import type { PluginInput } from "@opencode-ai/plugin";
import type { ContextLimitModelCacheState } from "./context-limit-resolver";
import { getContextWindowUsage, invalidateContextWindowUsageCache, _setContextWindowUsageFetchTimeoutMsForTesting, DEFAULT_CONTEXT_WINDOW_USAGE_FETCH_TIMEOUT_MS } from "./context-window-usage";
import type { TruncationOptions, TruncationResult } from "./dynamic-truncator-types";
import { truncateToTokenLimit } from "./token-limit-truncator";
export { DEFAULT_CONTEXT_WINDOW_USAGE_FETCH_TIMEOUT_MS, getContextWindowUsage, invalidateContextWindowUsageCache, _setContextWindowUsageFetchTimeoutMsForTesting, };
export { truncateToTokenLimit };
export type { TruncationOptions, TruncationResult };
export declare function dynamicTruncate(ctx: PluginInput, sessionID: string, output: string, options?: TruncationOptions, modelCacheState?: ContextLimitModelCacheState): Promise<TruncationResult>;
export declare function createDynamicTruncator(ctx: PluginInput, modelCacheState?: ContextLimitModelCacheState): {
    truncate: (sessionID: string, output: string, options?: TruncationOptions) => Promise<TruncationResult>;
    getUsage: (sessionID: string) => Promise<import("./dynamic-truncator-types").ContextWindowUsage | null>;
    truncateSync: (output: string, maxTokens: number, preserveHeaderLines?: number) => TruncationResult;
};
