import { hasContextPressureMarker } from "./context-pressure.js";
import type { PiRulesConfig } from "@oh-my-opencode/rules-engine/engine";
import { readTranscriptSearchText } from "./transcript-search.js";

export interface PostCompactBudgetContext {
	readonly model: string;
	readonly transcriptPath: string | null;
}

interface ModelContextBudget {
	readonly slug: string;
	readonly contextWindowTokens: number;
	readonly effectivePercent: number;
}

const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
const ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN = 3;
const PROJECTED_INJECTION_CHARS_PER_TOKEN = 2;
const POST_COMPACT_RESERVED_CONTEXT_PERCENT = 5;
const POST_COMPACT_MIN_RESERVED_TOKENS = 8_000;
const POST_COMPACT_MIN_GUIDE_CHARS = 500;
const FALLBACK_CONTEXT_WINDOW_TOKENS = 200_000;
const MODEL_CONTEXT_BUDGETS: readonly ModelContextBudget[] = [
	{ slug: "gpt-5.6-sol", contextWindowTokens: 372_000, effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT },
	{
		slug: "gpt-5.6-terra",
		contextWindowTokens: 372_000,
		effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
	},
	{
		slug: "gpt-5.6-luna",
		contextWindowTokens: 372_000,
		effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
	},
	{ slug: "gpt-5.5", contextWindowTokens: 272_000, effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT },
	{ slug: "gpt-5.4-mini", contextWindowTokens: 272_000, effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT },
	{
		slug: "codex-auto-review",
		contextWindowTokens: 272_000,
		effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
	},
];

export function withPostCompactBudget(config: PiRulesConfig, context?: PostCompactBudgetContext): PiRulesConfig {
	const postCompactMaxResultChars = dynamicPostCompactMaxResultChars(context) ?? config.postCompactMaxResultChars;
	const maxResultChars = Math.min(config.maxResultChars, config.postCompactMaxResultChars, postCompactMaxResultChars);
	const maxRuleChars = Math.min(config.maxRuleChars, config.postCompactMaxRuleChars, maxResultChars);
	return {
		...config,
		maxRuleChars,
		maxResultChars,
	};
}

function dynamicPostCompactMaxResultChars(context: PostCompactBudgetContext | undefined): number | undefined {
	if (context === undefined || context.transcriptPath === null) {
		return undefined;
	}

	const transcript = estimateTranscript(context.transcriptPath);
	if (transcript === undefined) {
		return undefined;
	}

	if (hasContextPressureMarker(transcript.text)) {
		return POST_COMPACT_MIN_GUIDE_CHARS;
	}

	const modelBudget = modelContextBudgetFor(context.model) ?? fallbackModelContextBudget();
	const effectiveContextWindow = Math.floor((modelBudget.contextWindowTokens * modelBudget.effectivePercent) / 100);
	const reservedTokens = Math.max(
		POST_COMPACT_MIN_RESERVED_TOKENS,
		Math.floor((effectiveContextWindow * POST_COMPACT_RESERVED_CONTEXT_PERCENT) / 100),
	);
	const injectableTokens = Math.max(0, effectiveContextWindow - reservedTokens - transcript.tokens);
	return Math.max(POST_COMPACT_MIN_GUIDE_CHARS, Math.floor(injectableTokens * PROJECTED_INJECTION_CHARS_PER_TOKEN));
}

function modelContextBudgetFor(model: string): ModelContextBudget | undefined {
	const normalizedModel = model.trim().toLowerCase();
	for (const budget of MODEL_CONTEXT_BUDGETS) {
		if (
			normalizedModel === budget.slug ||
			normalizedModel.endsWith(`.${budget.slug}`) ||
			normalizedModel.endsWith(`/${budget.slug}`)
		) {
			return budget;
		}
	}
	return undefined;
}

function fallbackModelContextBudget(): ModelContextBudget {
	return {
		slug: "unknown",
		contextWindowTokens: FALLBACK_CONTEXT_WINDOW_TOKENS,
		effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
	};
}

function estimateTranscript(transcriptPath: string): { readonly text: string; readonly tokens: number } | undefined {
	const transcriptText =
		readTranscriptSearchText(transcriptPath, { latestCompactedReplacementOnly: true }) ??
		readTranscriptSearchText(transcriptPath);
	if (transcriptText === null) {
		return undefined;
	}
	return {
		text: transcriptText,
		tokens: Math.ceil(Buffer.byteLength(transcriptText, "utf8") / ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN),
	};
}
