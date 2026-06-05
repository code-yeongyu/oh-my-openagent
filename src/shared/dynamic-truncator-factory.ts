import type { PluginInput } from "@opencode-ai/plugin";
import type { ContextLimitModelCacheState } from "./context-limit-resolver"
import { getContextWindowUsage } from "./context-window-usage"
import { dynamicTruncate } from "./dynamic-truncate"
import type { TruncationOptions } from "./dynamic-truncator-types"
import { truncateToTokenLimit } from "./token-limit-truncator"

export function createDynamicTruncator(
	ctx: PluginInput,
	modelCacheState?: ContextLimitModelCacheState,
) {
	return {
		truncate: (
			sessionID: string,
			output: string,
			options?: TruncationOptions,
		) => dynamicTruncate(ctx, sessionID, output, options, modelCacheState),

		getUsage: (sessionID: string) =>
			getContextWindowUsage(ctx, sessionID, modelCacheState),

		truncateSync: (
			output: string,
			maxTokens: number,
			preserveHeaderLines?: number,
		) => truncateToTokenLimit(output, maxTokens, preserveHeaderLines),
	};
}
