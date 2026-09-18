import type { PluginInput } from "@opencode-ai/plugin";
import { type ContextLimitModelCacheState } from "./context-limit-resolver";
import type { ContextWindowUsage } from "./dynamic-truncator-types";
export declare const DEFAULT_CONTEXT_WINDOW_USAGE_FETCH_TIMEOUT_MS = 5000;
export declare function _setContextWindowUsageFetchTimeoutMsForTesting(ms: number | undefined): void;
export declare function invalidateContextWindowUsageCache(ctx: PluginInput, sessionID?: string): void;
export declare function getContextWindowUsage(ctx: PluginInput, sessionID: string, modelCacheState?: ContextLimitModelCacheState): Promise<ContextWindowUsage | null>;
