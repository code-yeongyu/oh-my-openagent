import type {
	Api,
	Context,
	Model,
	SimpleStreamOptions,
	StreamOptions,
	ThinkingBudgets,
	ThinkingLevel,
} from "../types.ts";
import { estimateContextTokens } from "../utils/estimate.ts";

/**
 * Merge user-supplied extraBody fields into a provider request payload, skipping
 * any key the provider manages itself (model id, messages, stream flag, etc.).
 * Mutates `target` in place for zero-copy integration into per-provider builders.
 */
export function applyExtraBody(
	target: object,
	extraBody: Record<string, unknown> | undefined,
	reservedKeys: ReadonlySet<string>,
): void {
	if (!extraBody) return;
	for (const [key, value] of Object.entries(extraBody)) {
		if (reservedKeys.has(key)) continue;
		Reflect.set(target, key, value);
	}
}

export const OPENAI_COMPLETIONS_RESERVED_BODY_KEYS: ReadonlySet<string> = new Set([
	"model",
	"messages",
	"stream",
	"stream_options",
	"tools",
	"tool_choice",
	"store",
	"temperature",
	"max_tokens",
	"max_completion_tokens",
	"reasoning_effort",
	"reasoning",
	"thinking",
	"enable_thinking",
	"chat_template_kwargs",
	"tool_stream",
	"provider",
	"providerOptions",
]);

export const OPENAI_RESPONSES_RESERVED_BODY_KEYS: ReadonlySet<string> = new Set([
	"model",
	"input",
	"instructions",
	"stream",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"reasoning",
	"max_output_tokens",
	"temperature",
	"text",
	"store",
	"include",
	"prompt_cache_key",
	"prompt_cache_retention",
	"service_tier",
]);

/**
 * Reserved keys for the inner Google `config` object (which is serialized as the
 * request body's generationConfig/tools/systemInstruction by the @google/genai SDK).
 * extraBody is merged into `config`, not the top-level GenerateContentParameters.
 */
export const GOOGLE_RESERVED_BODY_KEYS: ReadonlySet<string> = new Set([
	"systemInstruction",
	"tools",
	"toolConfig",
	"temperature",
	"maxOutputTokens",
	"thinkingConfig",
	"responseMimeType",
	"responseSchema",
	"cachedContent",
	"abortSignal",
	"httpOptions",
]);

export const ANTHROPIC_RESERVED_BODY_KEYS: ReadonlySet<string> = new Set([
	"model",
	"messages",
	"system",
	"stream",
	"tools",
	"tool_choice",
	"temperature",
	"max_tokens",
	"thinking",
	"output_config",
	"metadata",
]);

export const MISTRAL_RESERVED_BODY_KEYS: ReadonlySet<string> = new Set([
	"model",
	"messages",
	"stream",
	"tools",
	"toolChoice",
	"temperature",
	"maxTokens",
	"promptMode",
]);

export const BEDROCK_RESERVED_BODY_KEYS: ReadonlySet<string> = new Set([
	"modelId",
	"messages",
	"system",
	"toolConfig",
	"additionalModelRequestFields",
	"inferenceConfig",
	"requestMetadata",
]);

const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;

export function clampMaxTokensToContext(model: Model<Api>, context: Context, maxTokens: number): number {
	if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);
	const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
	return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
}

export function buildBaseOptions(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
	apiKey?: string,
): StreamOptions {
	return {
		temperature: options?.temperature,
		maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		transport: options?.transport,
		cacheRetention: options?.cacheRetention ?? model.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		extraBody: options?.extraBody,
		onPayload: options?.onPayload,
		onResponse: options?.onResponse,
		timeoutMs: options?.timeoutMs,
		websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
		maxRetries: options?.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
		env: options?.env,
	};
}

export function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "xhigh" | "max"> | undefined {
	if (effort === "xhigh" || effort === "max") return "high";
	return effort;
}

/**
 * Clamp "max" to an OpenAI-compatible effort. OpenAI-style reasoning APIs accept
 * low|medium|high|xhigh but not "max". Callers that know the model supports xhigh
 * should pass through xhigh; "max" downgrades to "xhigh" on xhigh-capable models
 * and to "high" otherwise.
 */
export function clampMaxForOpenAI(
	effort: ThinkingLevel | undefined,
	xhighSupported: boolean,
): Exclude<ThinkingLevel, "max"> | undefined {
	if (effort === "max") return xhighSupported ? "xhigh" : "high";
	return effort;
}

export function adjustMaxTokensForThinking(
	// Undefined means no explicit caller cap. Use the model cap and fit thinking inside it.
	baseMaxTokens: number | undefined,
	modelMaxTokens: number,
	reasoningLevel: ThinkingLevel,
	customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
	const defaultBudgets: ThinkingBudgets = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
	};
	const budgets = { ...defaultBudgets, ...customBudgets };

	const minOutputTokens = 1024;
	const level = clampReasoning(reasoningLevel);
	if (!level) {
		return { maxTokens: baseMaxTokens ?? modelMaxTokens, thinkingBudget: 0 };
	}
	let thinkingBudget = budgets[level]!;
	const maxTokens =
		baseMaxTokens === undefined ? modelMaxTokens : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

	if (maxTokens <= thinkingBudget) {
		thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
	}

	return { maxTokens, thinkingBudget };
}
