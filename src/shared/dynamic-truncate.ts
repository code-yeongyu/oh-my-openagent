import type { PluginInput } from "@opencode-ai/plugin";
import type { ContextLimitModelCacheState } from "./context-limit-resolver"
import { getContextWindowUsage } from "./context-window-usage"
import type {
	TruncationOptions,
	TruncationResult,
} from "./dynamic-truncator-types"
import { truncateToTokenLimit } from "./token-limit-truncator"

const DEFAULT_TARGET_MAX_TOKENS = 50_000;

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
