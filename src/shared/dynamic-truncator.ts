import type { PluginInput } from "@opencode-ai/plugin";
import { normalizeSDKResponse } from "./normalize-sdk-response";
import { compressForLLM } from "./toon-compression/compressor";
import { DEFAULT_COMPRESSION_CONFIG } from "./toon-compression/config-store";
import type { ToonCompressionConfig } from "./toon-compression";

const DEFAULT_ANTHROPIC_ACTUAL_LIMIT = 200_000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_TARGET_MAX_TOKENS = 50_000;
type ModelCacheStateLike = {
	anthropicContext1MEnabled: boolean;
}

function getAnthropicActualLimit(modelCacheState?: ModelCacheStateLike): number {
	return (modelCacheState?.anthropicContext1MEnabled ?? false) ||
		process.env.ANTHROPIC_1M_CONTEXT === "true" ||
		process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
		? 1_000_000
		: DEFAULT_ANTHROPIC_ACTUAL_LIMIT;
}

interface AssistantMessageInfo {
	role: "assistant";
	tokens: {
		input: number;
		output: number;
		reasoning: number;
		cache: { read: number; write: number };
	};
}

interface MessageWrapper {
	info: { role: string } & Partial<AssistantMessageInfo>;
}

export interface TruncationResult {
	result: string;
	truncated: boolean;
	removedCount?: number;
}

export interface TruncationOptions {
	targetMaxTokens?: number;
	preserveHeaderLines?: number;
	contextWindowLimit?: number;
	compression?: ToonCompressionConfig;
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

function tryParseJson(value: string): unknown | null {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function tryCompress(output: string, config: ToonCompressionConfig): string {
	if (!config.enabled) {
		return output;
	}

	try {
		const parsed = tryParseJson(output);
		if (parsed === null) {
			return output;
		}
		return compressForLLM(parsed, config, "dynamic-truncator");
	} catch {
		return output;
	}
}
export function truncateToTokenLimit(
	output: string,
	maxTokens: number,
	preserveHeaderLines = 3,
	compressionConfig: ToonCompressionConfig = DEFAULT_COMPRESSION_CONFIG,
): TruncationResult {
	if (typeof output !== 'string') {
		return { result: String(output ?? ''), truncated: false };
	}

	// Apply compression before truncation
	const compressedOutput = tryCompress(output, compressionConfig);
	const currentTokens = estimateTokens(compressedOutput);
	if (currentTokens <= maxTokens) {
		return { result: compressedOutput, truncated: false };
	}

	const lines = compressedOutput.split("\n");

	if (lines.length <= preserveHeaderLines) {
		const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
		return {
			result:
				compressedOutput.slice(0, maxChars) +
				"\n\n[Output truncated due to context window limit]",
			truncated: true,
		};
	}

	const headerLines = lines.slice(0, preserveHeaderLines);
	const contentLines = lines.slice(preserveHeaderLines);

	const headerText = headerLines.join("\n");
	const headerTokens = estimateTokens(headerText);
	const truncationMessageTokens = 50;
	const availableTokens = maxTokens - headerTokens - truncationMessageTokens;

	if (availableTokens <= 0) {
		return {
			result:
				headerText + "\n\n[Content truncated due to context window limit]",
			truncated: true,
			removedCount: contentLines.length,
		};
	}

	const resultLines: string[] = [];
	let currentTokenCount = 0;

	for (const line of contentLines) {
		const lineTokens = estimateTokens(line + "\n");
		if (currentTokenCount + lineTokens > availableTokens) {
			break;
		}
		resultLines.push(line);
		currentTokenCount += lineTokens;
	}

	const truncatedContent = [...headerLines, ...resultLines].join("\n");
	const removedCount = contentLines.length - resultLines.length;

	return {
		result:
			truncatedContent +
			`\n\n[${removedCount} more lines truncated due to context window limit]`,
		truncated: true,
		removedCount,
	};
}

export async function getContextWindowUsage(
	ctx: PluginInput,
	sessionID: string,
	modelCacheState?: ModelCacheStateLike,
): Promise<{
	usedTokens: number;
	remainingTokens: number;
	usagePercentage: number;
} | null> {
	try {
		const response = await ctx.client.session.messages({
			path: { id: sessionID },
		});

		const messages = normalizeSDKResponse(response, [] as MessageWrapper[], { preferResponseOnMissingData: true })

		const assistantMessages = messages
			.filter((m) => m.info.role === "assistant")
			.map((m) => m.info as AssistantMessageInfo);

		if (assistantMessages.length === 0) return null;

		const lastAssistant = assistantMessages[assistantMessages.length - 1];
		const lastTokens = lastAssistant.tokens;
		const usedTokens =
			(lastTokens?.input ?? 0) +
			(lastTokens?.cache?.read ?? 0) +
			(lastTokens?.output ?? 0);
		const anthropicActualLimit = getAnthropicActualLimit(modelCacheState);
		const remainingTokens = anthropicActualLimit - usedTokens;

		return {
			usedTokens,
			remainingTokens,
			usagePercentage: usedTokens / anthropicActualLimit,
		};
	} catch {
		return null;
	}
}

export async function dynamicTruncate(
	ctx: PluginInput,
	sessionID: string,
	output: string,
	options: TruncationOptions = {},
	modelCacheState?: ModelCacheStateLike,
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
		return truncateToTokenLimit(output, targetMaxTokens, preserveHeaderLines, options.compression);
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

	return truncateToTokenLimit(output, maxOutputTokens, preserveHeaderLines, options.compression);
}

export function createDynamicTruncator(
	ctx: PluginInput,
	modelCacheState?: ModelCacheStateLike,
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
