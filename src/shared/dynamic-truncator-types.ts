import type { PluginInput } from "@opencode-ai/plugin";

export type ContextWindowUsage = {
	usedTokens: number;
	remainingTokens: number;
	usagePercentage: number;
}

export type ContextWindowUsageClient = Pick<PluginInput["client"], "session">

export interface TruncationResult {
	result: string;
	truncated: boolean;
	removedCount?: number;
}

export interface TruncationOptions {
	targetMaxTokens?: number;
	preserveHeaderLines?: number;
	contextWindowLimit?: number;
}
