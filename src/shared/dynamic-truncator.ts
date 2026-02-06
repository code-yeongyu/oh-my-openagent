import type { PluginInput } from "@opencode-ai/plugin";
import {
	resolveContextWindowLimit,
	type ContextWindowLimitOptions,
} from "./context-window-limit-resolver";

const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_TARGET_MAX_TOKENS = 50_000;

interface AssistantMessageInfo {
	role: "assistant";
	providerID?: string;
	modelID?: string;
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
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function truncateToTokenLimit(
	output: string,
	maxTokens: number,
	preserveHeaderLines = 3,
): TruncationResult {
	if (typeof output !== 'string') {
		return { result: String(output ?? ''), truncated: false };
	}

	const currentTokens = estimateTokens(output);

	if (currentTokens <= maxTokens) {
		return { result: output, truncated: false };
	}

	const lines = output.split("\n");

	if (lines.length <= preserveHeaderLines) {
		const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
		return {
			result:
				output.slice(0, maxChars) +
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
	limitOptions?: ContextWindowLimitOptions,
): Promise<{
	usedTokens: number;
	remainingTokens: number;
	usagePercentage: number;
} | null> {
	try {
		const response = await ctx.client.session.messages({
			path: { id: sessionID },
		});

		const messages = (response.data ?? response) as MessageWrapper[];

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
		const contextWindowLimit = resolveContextWindowLimit({
			...limitOptions,
			providerID: limitOptions?.providerID ?? lastAssistant.providerID,
			modelID: limitOptions?.modelID ?? lastAssistant.modelID,
		});
		const remainingTokens = contextWindowLimit - usedTokens;

		return {
			usedTokens,
			remainingTokens,
			usagePercentage: usedTokens / contextWindowLimit,
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
	limitOptions?: ContextWindowLimitOptions,
): Promise<TruncationResult> {
	if (typeof output !== 'string') {
		return { result: String(output ?? ''), truncated: false };
	}

	const {
		targetMaxTokens = DEFAULT_TARGET_MAX_TOKENS,
		preserveHeaderLines = 3,
		contextWindowLimit,
	} = options;

	const usage = await getContextWindowUsage(ctx, sessionID, {
		...limitOptions,
		contextWindowLimit: contextWindowLimit ?? limitOptions?.contextWindowLimit,
	});

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
	limitOptions?: ContextWindowLimitOptions,
) {
	return {
		truncate: (
			sessionID: string,
			output: string,
			options?: TruncationOptions,
		) => dynamicTruncate(ctx, sessionID, output, options, limitOptions),

		getUsage: (sessionID: string) =>
			getContextWindowUsage(ctx, sessionID, limitOptions ?? {}),

		truncateSync: (
			output: string,
			maxTokens: number,
			preserveHeaderLines?: number,
		) => truncateToTokenLimit(output, maxTokens, preserveHeaderLines),
	};
}
