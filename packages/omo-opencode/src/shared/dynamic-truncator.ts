import type { PluginInput } from "@opencode-ai/plugin";
import type { ContextLimitModelCacheState } from "./context-limit-resolver"
import {
	getContextWindowUsage,
	invalidateContextWindowUsageCache,
	_setContextWindowUsageFetchTimeoutMsForTesting,
	DEFAULT_CONTEXT_WINDOW_USAGE_FETCH_TIMEOUT_MS,
} from "./context-window-usage"
import type {
	TruncationOptions,
	TruncationResult,
} from "./dynamic-truncator-types"
import { truncateToTokenLimit } from "./token-limit-truncator"

const DEFAULT_TARGET_MAX_TOKENS = 50_000;

export {
	DEFAULT_CONTEXT_WINDOW_USAGE_FETCH_TIMEOUT_MS,
	getContextWindowUsage,
	invalidateContextWindowUsageCache,
	_setContextWindowUsageFetchTimeoutMsForTesting,
}
export { truncateToTokenLimit }
export type { TruncationOptions, TruncationResult }

export async function dynamicTruncate(
	ctx: PluginInput,
	sessionID: string,
	output: string,
	options: TruncationOptions = {},
	modelCacheState?: ContextLimitModelCacheState,
): Promise<TruncationResult> {
	if (typeof output !== 'string') {
		return { result: String(output ?? ''), truncated: false };
	}

	const {
		targetMaxTokens = DEFAULT_TARGET_MAX_TOKENS,
		preserveHeaderLines = 3,
	} = options;

	const usage = await getContextWindowUsage(ctx, sessionID, modelCacheState);

	if (!usage) {
		// Fallback: apply conservative truncation when context usage unavailable
		return truncateToTokenLimit(output, targetMaxTokens, preserveHeaderLines);
	}

	const maxOutputTokens = Math.min(
		usage.remainingTokens * 0.5,
		targetMaxTokens,
	);

	if (maxOutputTokens <= 0) {
		return {
			result: "[Output suppressed - context window exhausted]",
			truncated: true,
		};
	}

	return truncateToTokenLimit(output, maxOutputTokens, preserveHeaderLines);
}

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
