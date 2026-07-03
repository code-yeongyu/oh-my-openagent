import Anthropic from "@anthropic-ai/sdk";
import type {
	CacheControlEphemeral,
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
	RawMessageStreamEvent,
	RefusalStopDetails,
} from "@anthropic-ai/sdk/resources/messages.js";
import { calculateCost } from "../models.ts";
import type {
	AnthropicMessagesCompat,
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	ImageContent,
	Message,
	Model,
	ProviderEnv,
	ProviderNativeContent,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";
import { parseJsonWithRepair, parseStreamingJson } from "../utils/json-parse.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { isForcedToolChoiceUnsupportedError, omitToolChoiceParam } from "../utils/tool-choice-fallback.ts";

import { resolveCloudflareBaseUrl } from "./cloudflare.ts";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./github-copilot-headers.ts";
import {
	ANTHROPIC_RESERVED_BODY_KEYS,
	adjustMaxTokensForThinking,
	buildBaseOptions,
	clampMaxTokensToContext,
} from "./simple-options.ts";
import { transformMessages } from "./transform-messages.ts";

/**
 * Resolve cache retention preference.
 * Defaults to the provided fallback and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(
	cacheRetention?: CacheRetention,
	env?: ProviderEnv,
	fallback: CacheRetention = "short",
): CacheRetention {
	if (cacheRetention) {
		return cacheRetention;
	}
	if (getProviderEnvValue("PI_CACHE_RETENTION", env) === "long") {
		return "long";
	}
	if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION !== undefined) {
		return "short";
	}
	return fallback;
}

function isAnthropicApiBaseUrl(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname === "api.anthropic.com";
	} catch {
		return false;
	}
}

function getCacheControl(
	model: Model<"anthropic-messages">,
	cacheRetention?: CacheRetention,
	env?: ProviderEnv,
): { retention: CacheRetention; cacheControl?: CacheControlEphemeral } {
	const retention = resolveCacheRetention(cacheRetention, env, "long");
	if (retention === "none") {
		return { retention };
	}
	const ttl =
		retention === "long" &&
		isAnthropicApiBaseUrl(model.baseUrl) &&
		getAnthropicCompat(model).supportsLongCacheRetention
			? "1h"
			: undefined;
	return {
		retention,
		cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
	};
}

// Stealth mode: Mimic Claude Code's tool naming exactly
const claudeCodeVersion = "2.1.75";

// Claude Code 2.x tool names (canonical casing)
// Source: https://cchistory.mariozechner.at/data/prompts-2.1.11.md
// To update: https://github.com/badlogic/cchistory
const claudeCodeTools = [
	"Read",
	"Write",
	"Edit",
	"Bash",
	"Grep",
	"Glob",
	"AskUserQuestion",
	"EnterPlanMode",
	"ExitPlanMode",
	"KillShell",
	"NotebookEdit",
	"Skill",
	"Task",
	"TaskOutput",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
];

const ccToolLookup = new Map(claudeCodeTools.map((t) => [t.toLowerCase(), t]));

// Convert tool name to CC canonical casing if it matches (case-insensitive)
const toClaudeCodeName = (name: string) => ccToolLookup.get(name.toLowerCase()) ?? name;
const fromClaudeCodeName = (name: string, tools?: Tool[]) => {
	if (tools && tools.length > 0) {
		const lowerName = name.toLowerCase();
		const matchedTool = tools.find((tool) => tool.name.toLowerCase() === lowerName);
		if (matchedTool) return matchedTool.name;
	}
	return name;
};

/**
 * Convert content blocks to Anthropic API format
 */
function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	// If only text blocks, return as concatenated string for simplicity
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	// If we have images, convert to content block array
	const blocks = content.map((block) => {
		if (block.type === "text") {
			return {
				type: "text" as const,
				text: sanitizeSurrogates(block.text),
			};
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});

	// If only images (no text), add placeholder text block
	const hasText = blocks.some((b) => b.type === "text");
	if (!hasText) {
		blocks.unshift({
			type: "text" as const,
			text: "(see attached image)",
		});
	}

	return blocks;
}

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicThinkingDisplay = "summarized" | "omitted";

const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
const COMPUTER_USE_BETA_PREFIX = "computer-use-";
const NATIVE_COMPUTER_TOOL_TYPE = "computer_20250124";
const ADAPTIVE_THINKING_MODEL_MARKERS = ["opus-4-6", "opus-4-7", "sonnet-4-6"] as const;
const CLAUDE_FABLE_OR_MYTHOS_MODEL_ID = /^claude-(?:fable|mythos)(?:-|$)/i;
const UNSUPPORTED_NATIVE_COMPUTER_TOOL_MODEL_MARKERS = [
	"opus-4-6",
	"opus-4.6",
	"opus-4-7",
	"opus-4.7",
	"opus-4-8",
	"opus-4.8",
] as const;

function getAnthropicCompat(
	model: Model<"anthropic-messages">,
): Required<Omit<AnthropicMessagesCompat, "forceAdaptiveThinking">> {
	// Auto-detect session affinity and cache control support from provider
	const isFireworks = model.provider === "fireworks";
	const isCloudflareAiGatewayAnthropic =
		model.provider === "cloudflare-ai-gateway" && model.baseUrl.includes("anthropic");
	const isXiaomi = model.provider === "xiaomi" || model.provider.startsWith("xiaomi-token-plan-");
	return {
		supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? !isFireworks,
		supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? !isFireworks,
		sendSessionAffinityHeaders:
			model.compat?.sendSessionAffinityHeaders ?? !!(isFireworks || isCloudflareAiGatewayAnthropic),
		supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? !isFireworks,
		supportsDisabledThinking: model.compat?.supportsDisabledThinking ?? !isXiaomi,
		supportsTemperature: model.compat?.supportsTemperature ?? true,
		supportsToolChoice: model.compat?.supportsToolChoice ?? true,
		supportsForcedToolChoice:
			model.compat?.supportsForcedToolChoice ?? !CLAUDE_FABLE_OR_MYTHOS_MODEL_ID.test(model.id),
		allowEmptySignature: model.compat?.allowEmptySignature ?? false,
	};
}

export interface AnthropicOptions extends StreamOptions {
	/**
	 * Enable extended thinking.
	 * For adaptive thinking models: the model decides when/how much to think.
	 * For older models: uses budget-based thinking with thinkingBudgetTokens.
	 * Default: undefined (thinking is omitted unless `streamSimpleAnthropic()` maps
	 * a simple reasoning level to this option, or callers set it explicitly).
	 */
	thinkingEnabled?: boolean;
	/**
	 * Token budget for extended thinking (older models only).
	 * Ignored for adaptive thinking models.
	 * Default: 1024 when `thinkingEnabled` is true and no budget is provided.
	 */
	thinkingBudgetTokens?: number;
	/**
	 * Effort level for adaptive thinking models.
	 * Controls how much thinking Claude allocates:
	 * - "max": Always thinks with no constraints (Opus 4.6 only)
	 * - "xhigh": Highest reasoning level (Opus 4.7+, Fable 5)
	 * - "high": Always thinks, deep reasoning
	 * - "medium": Moderate thinking, may skip for simple queries
	 * - "low": Minimal thinking, skips for simple tasks
	 * Ignored for older models.
	 * Default: omitted unless `streamSimpleAnthropic()` maps a simple reasoning
	 * level to this option.
	 */
	effort?: AnthropicEffort;
	/**
	 * Controls how thinking content is returned in API responses.
	 * - "summarized": Thinking blocks contain summarized thinking text.
	 * - "omitted": Thinking blocks return an empty thinking field; the encrypted
	 *   signature still travels back for multi-turn continuity. Use for faster
	 *   time-to-first-text-token when your UI does not surface thinking.
	 *
	 * Note: Anthropic's API default for Claude Opus 4.7 and Claude Mythos Preview
	 * is "omitted". We default to "summarized" here to keep behavior consistent
	 * with older Claude 4 models. Set this explicitly to "omitted" to opt in.
	 * Default: "summarized" when thinking is enabled.
	 */
	thinkingDisplay?: AnthropicThinkingDisplay;
	/**
	 * Whether to request the interleaved thinking beta header for non-adaptive
	 * thinking models. Adaptive thinking models have interleaved thinking built in,
	 * so the header is skipped for them regardless of this setting.
	 * Default: true.
	 */
	interleavedThinking?: boolean;
	/**
	 * Anthropic tool choice behavior. String values map to Anthropic's built-in
	 * choices; `{ type: "tool", name }` forces a specific tool.
	 * Default: omitted (Anthropic default behavior, currently equivalent to auto).
	 */
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	/**
	 * Pre-built Anthropic client instance. When provided, skips internal client
	 * construction entirely. Use this to inject alternative SDK clients such as
	 * `AnthropicVertex` that shares the same messaging API.
	 */
	client?: Anthropic;
}

function mergeHeaders(...headerSources: (Record<string, string | null> | undefined)[]): Record<string, string | null> {
	const merged: Record<string, string | null> = {};
	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}
	return merged;
}

interface ServerSentEvent {
	event: string | null;
	data: string;
	raw: string[];
}

type AnthropicPayloadWithRequestMetadata = MessageCreateParamsStreaming & {
	headers?: unknown;
	extra_body?: unknown;
};

interface SseDecoderState {
	event: string | null;
	data: string[];
	raw: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const REPLAYABLE_ANTHROPIC_PROVIDER_NATIVE_TYPES: ReadonlySet<string> = new Set([
	"server_tool_use",
	"web_search_tool_result",
	"web_fetch_tool_result",
	"code_execution_tool_result",
	"bash_code_execution_tool_result",
	"text_editor_code_execution_tool_result",
	"tool_search_tool_result",
	"container_upload",
	// Server-side fallback beta (server-side-fallback-2026-06-01) emits a
	// `fallback` block mid-response, interleaved with thinking blocks. The API
	// requires the latest assistant message to be replayed with its block
	// sequence unmodified; dropping the block yields a 400
	// ("thinking ... blocks in the latest assistant message cannot be modified").
	"fallback",
]);

function isReplayableAnthropicProviderNativeBlock(raw: unknown): raw is ContentBlockParam {
	return isRecord(raw) && typeof raw.type === "string" && REPLAYABLE_ANTHROPIC_PROVIDER_NATIVE_TYPES.has(raw.type);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const entries = Object.entries(value);
	if (entries.some(([, item]) => typeof item !== "string")) {
		return undefined;
	}

	return Object.fromEntries(entries) as Record<string, string>;
}

function isForcedAnthropicToolChoice(toolChoice: MessageCreateParamsStreaming["tool_choice"] | undefined): boolean {
	return isRecord(toolChoice) && (toolChoice.type === "any" || toolChoice.type === "tool");
}

function extractPayloadRequestMetadata(params: MessageCreateParamsStreaming): {
	params: MessageCreateParamsStreaming;
	headers?: Record<string, string>;
} {
	const payload = params as AnthropicPayloadWithRequestMetadata;
	const headers = stringRecord(payload.headers);

	if (!("headers" in payload) && !("extra_body" in payload)) {
		return headers ? { params, headers } : { params };
	}

	const stripped: AnthropicPayloadWithRequestMetadata = { ...payload };
	delete stripped.headers;
	delete stripped.extra_body;

	return headers ? { params: stripped, headers } : { params: stripped };
}

function removeAnthropicBetaHeaders(
	headers: Record<string, string | null> | undefined,
	shouldRemoveBeta: (beta: string) => boolean,
): {
	changed: boolean;
	headers?: Record<string, string | null>;
} {
	if (!headers) {
		return { changed: false };
	}

	const nextHeaders: Record<string, string | null> = {};
	let changed = false;

	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== "anthropic-beta" || value === null) {
			nextHeaders[key] = value;
			continue;
		}

		const betas = value
			.split(",")
			.map((beta) => beta.trim())
			.filter((beta) => beta.length > 0);
		const supportedBetas = betas.filter((beta) => !shouldRemoveBeta(beta));
		changed = changed || supportedBetas.length !== betas.length;

		if (supportedBetas.length > 0) {
			nextHeaders[key] = supportedBetas.join(", ");
		}
	}

	if (!changed) {
		return { changed: false, headers };
	}

	return {
		changed: true,
		headers: Object.keys(nextHeaders).length > 0 ? nextHeaders : undefined,
	};
}

function removeComputerUseBetaHeader(headers: Record<string, string> | undefined): {
	changed: boolean;
	headers?: Record<string, string | null>;
} {
	return removeAnthropicBetaHeaders(headers, (beta) => beta.startsWith(COMPUTER_USE_BETA_PREFIX));
}

function sanitizeAdaptiveThinkingHeaders(
	model: Model<"anthropic-messages">,
	headers: Record<string, string | null>,
): Record<string, string | null> {
	if (!supportsAdaptiveThinking(model)) {
		return headers;
	}

	const headerSanitization = removeAnthropicBetaHeaders(headers, (beta) => beta === INTERLEAVED_THINKING_BETA);
	return headerSanitization.changed ? (headerSanitization.headers ?? {}) : headers;
}

function rejectsNativeComputerTool(model: Model<"anthropic-messages">, toolType: string): boolean {
	if (model.provider === "cloudflare-ai-gateway" && model.baseUrl.includes("anthropic")) {
		return toolType.startsWith("computer_");
	}
	return (
		matchesModelMarker(model, UNSUPPORTED_NATIVE_COMPUTER_TOOL_MODEL_MARKERS) &&
		toolType === NATIVE_COMPUTER_TOOL_TYPE
	);
}

function rejectsComputerUseBeta(model: Model<"anthropic-messages">): boolean {
	return (
		(model.provider === "cloudflare-ai-gateway" && model.baseUrl.includes("anthropic")) ||
		matchesModelMarker(model, UNSUPPORTED_NATIVE_COMPUTER_TOOL_MODEL_MARKERS)
	);
}

function sanitizeUnsupportedNativeTools(
	model: Model<"anthropic-messages">,
	params: MessageCreateParamsStreaming,
): MessageCreateParamsStreaming {
	const payload = params as AnthropicPayloadWithRequestMetadata;
	const headers = stringRecord(payload.headers);
	const headerSanitization = rejectsComputerUseBeta(model)
		? removeComputerUseBetaHeader(headers)
		: ({ changed: false } as const);
	const tools = payload.tools;
	const sanitized: AnthropicPayloadWithRequestMetadata = { ...payload };
	let changed = false;
	const removedToolNames = new Set<string>();

	if (Array.isArray(tools)) {
		const supportedTools: typeof tools = [];

		for (const tool of tools) {
			const hookTool: unknown = tool;
			if (
				isRecord(hookTool) &&
				typeof hookTool.type === "string" &&
				rejectsNativeComputerTool(model, hookTool.type)
			) {
				changed = true;
				if (typeof hookTool.name === "string") {
					removedToolNames.add(hookTool.name);
				}
				continue;
			}

			supportedTools.push(tool);
		}

		if (changed) {
			if (supportedTools.length > 0) {
				sanitized.tools = supportedTools;
			} else {
				delete sanitized.tools;
			}
		}
	}

	if (headerSanitization.changed) {
		changed = true;
		if (headerSanitization.headers) {
			sanitized.headers = headerSanitization.headers;
		} else {
			delete sanitized.headers;
		}
	}

	if (changed && isRecord(sanitized.tool_choice)) {
		const toolChoiceName = sanitized.tool_choice.name;
		const shouldRemoveToolChoice =
			(typeof toolChoiceName === "string" && removedToolNames.has(toolChoiceName)) || sanitized.tools === undefined;
		if (shouldRemoveToolChoice) {
			delete sanitized.tool_choice;
		}
	}

	return changed ? (sanitized as MessageCreateParamsStreaming) : params;
}

function sanitizeAdaptiveThinkingPayload(
	model: Model<"anthropic-messages">,
	params: MessageCreateParamsStreaming,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	if (!supportsAdaptiveThinking(model)) {
		return params;
	}

	const payload = params as AnthropicPayloadWithRequestMetadata;
	const headers = stringRecord(payload.headers);
	const headerSanitization = removeAnthropicBetaHeaders(headers, (beta) => beta === INTERLEAVED_THINKING_BETA);
	const sanitized: AnthropicPayloadWithRequestMetadata = { ...payload };
	let changed = false;

	const thinking = isRecord(payload.thinking) ? payload.thinking : undefined;
	if (thinking?.type === "enabled") {
		const display =
			thinking.display === "omitted" || thinking.display === "summarized"
				? thinking.display
				: (options?.thinkingDisplay ?? "summarized");
		sanitized.thinking = { type: "adaptive", display } as MessageCreateParamsStreaming["thinking"];
		if (options?.effort !== undefined && !isRecord(payload.output_config)) {
			sanitized.output_config = { effort: options.effort } as NonNullable<
				MessageCreateParamsStreaming["output_config"]
			>;
		}
		changed = true;
	}

	if (headerSanitization.changed) {
		changed = true;
		if (headerSanitization.headers) {
			sanitized.headers = headerSanitization.headers;
		} else {
			delete sanitized.headers;
		}
	}

	return changed ? (sanitized as MessageCreateParamsStreaming) : params;
}

function isCacheableUserContentBlock(
	block: ContentBlockParam | undefined,
): block is Extract<ContentBlockParam, { type: "text" | "image" | "tool_result" }> {
	return block?.type === "text" || block?.type === "image" || block?.type === "tool_result";
}

const ANTHROPIC_MESSAGE_EVENTS: ReadonlySet<string> = new Set([
	"message_start",
	"message_delta",
	"message_stop",
	"content_block_start",
	"content_block_delta",
	"content_block_stop",
]);

function flushSseEvent(state: SseDecoderState): ServerSentEvent | null {
	if (!state.event && state.data.length === 0) {
		return null;
	}

	const event: ServerSentEvent = {
		event: state.event,
		data: state.data.join("\n"),
		raw: [...state.raw],
	};
	state.event = null;
	state.data = [];
	state.raw = [];
	return event;
}

function decodeSseLine(line: string, state: SseDecoderState): ServerSentEvent | null {
	if (line === "") {
		return flushSseEvent(state);
	}

	state.raw.push(line);
	if (line.startsWith(":")) {
		return null;
	}

	const delimiterIndex = line.indexOf(":");
	const fieldName = delimiterIndex === -1 ? line : line.slice(0, delimiterIndex);
	let value = delimiterIndex === -1 ? "" : line.slice(delimiterIndex + 1);
	if (value.startsWith(" ")) {
		value = value.slice(1);
	}

	if (fieldName === "event") {
		state.event = value;
	} else if (fieldName === "data") {
		state.data.push(value);
	}

	return null;
}

function nextLineBreakIndex(text: string): number {
	const carriageReturnIndex = text.indexOf("\r");
	const newlineIndex = text.indexOf("\n");
	if (carriageReturnIndex === -1) {
		return newlineIndex;
	}
	if (newlineIndex === -1) {
		return carriageReturnIndex;
	}
	return Math.min(carriageReturnIndex, newlineIndex);
}

function consumeLine(text: string): { line: string; rest: string } | null {
	const lineBreakIndex = nextLineBreakIndex(text);
	if (lineBreakIndex === -1) {
		return null;
	}

	let nextIndex = lineBreakIndex + 1;
	if (text[lineBreakIndex] === "\r" && text[nextIndex] === "\n") {
		nextIndex += 1;
	}

	return {
		line: text.slice(0, lineBreakIndex),
		rest: text.slice(nextIndex),
	};
}

async function* iterateSseMessages(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const state: SseDecoderState = { event: null, data: [], raw: [] };
	let buffer = "";

	try {
		while (true) {
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}

			const { value, done } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			let consumed = consumeLine(buffer);
			while (consumed) {
				buffer = consumed.rest;
				const event = decodeSseLine(consumed.line, state);
				if (event) {
					yield event;
				}
				consumed = consumeLine(buffer);
			}
		}

		buffer += decoder.decode();
		let consumed = consumeLine(buffer);
		while (consumed) {
			buffer = consumed.rest;
			const event = decodeSseLine(consumed.line, state);
			if (event) {
				yield event;
			}
			consumed = consumeLine(buffer);
		}

		if (buffer.length > 0) {
			const event = decodeSseLine(buffer, state);
			if (event) {
				yield event;
			}
		}

		const trailingEvent = flushSseEvent(state);
		if (trailingEvent) {
			yield trailingEvent;
		}
	} finally {
		reader.releaseLock();
	}
}

async function* iterateAnthropicEvents(
	response: Response,
	signal?: AbortSignal,
): AsyncGenerator<RawMessageStreamEvent> {
	if (!response.body) {
		throw new Error("Attempted to iterate over an Anthropic response with no body");
	}

	let sawMessageStart = false;
	let sawMessageEnd = false;

	for await (const sse of iterateSseMessages(response.body, signal)) {
		if (sse.event === "error") {
			throw new Error(sse.data);
		}

		if (!ANTHROPIC_MESSAGE_EVENTS.has(sse.event ?? "")) {
			continue;
		}

		try {
			const event = parseJsonWithRepair<RawMessageStreamEvent>(sse.data);
			if (event.type === "message_start") {
				sawMessageStart = true;
			} else if (event.type === "message_stop") {
				sawMessageEnd = true;
			}
			yield event;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Could not parse Anthropic SSE event ${sse.event}: ${message}; data=${sse.data}; raw=${sse.raw.join("\\n")}`,
			);
		}
	}

	if (sawMessageStart && !sawMessageEnd) {
		throw new Error("Anthropic stream ended before message_stop");
	}
}

export const stream: StreamFunction<"anthropic-messages", AnthropicOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			let client: Anthropic;
			let isOAuth: boolean;

			if (options?.client) {
				client = options.client;
				isOAuth = false;
			} else {
				const apiKey = options?.apiKey;
				if (!apiKey) {
					throw new Error(`No API key for provider: ${model.provider}`);
				}

				let copilotDynamicHeaders: Record<string, string> | undefined;
				if (model.provider === "github-copilot") {
					const hasImages = hasCopilotVisionInput(context.messages);
					copilotDynamicHeaders = buildCopilotDynamicHeaders({
						messages: context.messages,
						hasImages,
					});
				}

				const cacheRetention = resolveCacheRetention(
					options?.cacheRetention ?? model.cacheRetention,
					options?.env,
					"long",
				);
				const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;

				const created = createClient(
					model,
					apiKey,
					options?.interleavedThinking ?? true,
					shouldUseFineGrainedToolStreamingBeta(model, context),
					providerHeadersToRecord(options?.headers),
					copilotDynamicHeaders,
					cacheSessionId,
					options?.env,
				);
				client = created.client;
				isOAuth = created.isOAuthToken;
			}
			let params = buildParams(model, context, isOAuth, options);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== undefined) {
				params = nextParams as MessageCreateParamsStreaming;
			}
			params = sanitizeAdaptiveThinkingPayload(model, params, options);
			params = sanitizeUnsupportedNativeTools(model, params);
			const payloadRequestMetadata = extractPayloadRequestMetadata(params);
			params = payloadRequestMetadata.params;
			const requestOptions = {
				...(options?.signal ? { signal: options.signal } : {}),
				...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
				maxRetries: options?.maxRetries ?? 0,
				...(payloadRequestMetadata.headers ? { headers: payloadRequestMetadata.headers } : {}),
			};
			let response: Response;
			try {
				response = await client.messages.create({ ...params, stream: true }, requestOptions).asResponse();
			} catch (error) {
				if (isForcedToolChoiceUnsupportedError(error, isForcedAnthropicToolChoice(params.tool_choice))) {
					params = omitToolChoiceParam(params);
					response = await client.messages.create({ ...params, stream: true }, requestOptions).asResponse();
				} else {
					throw error;
				}
			}
			await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
			stream.push({ type: "start", partial: output });

			type Block =
				| (ThinkingContent & { index?: number })
				| (TextContent & { index?: number })
				| ((ToolCall & { partialJson: string }) & { index?: number })
				| (ProviderNativeContent & { index?: number });
			const blocks = output.content as Block[];

			for await (const event of iterateAnthropicEvents(response, options?.signal)) {
				if (event.type === "message_start") {
					output.responseId = event.message.id;
					// Capture initial token usage from message_start event
					// This ensures we have input token counts even if the stream is aborted early
					output.usage.input = event.message.usage.input_tokens || 0;
					output.usage.output = event.message.usage.output_tokens || 0;
					output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
					output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
					output.usage.cacheWrite1h = event.message.usage.cache_creation?.ephemeral_1h_input_tokens || 0;
					// Anthropic doesn't provide total_tokens, compute from components
					output.usage.totalTokens =
						output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
					calculateCost(model, output.usage);
				} else if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						const block: Block = {
							type: "text",
							text: "",
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "thinking") {
						const block: Block = {
							type: "thinking",
							thinking: "",
							thinkingSignature: "",
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "redacted_thinking") {
						const block: Block = {
							type: "thinking",
							thinking: "[Reasoning redacted]",
							thinkingSignature: event.content_block.data,
							redacted: true,
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "tool_use") {
						const block: Block = {
							type: "toolCall",
							id: event.content_block.id,
							name: isOAuth
								? fromClaudeCodeName(event.content_block.name, context.tools)
								: event.content_block.name,
							arguments: isRecord(event.content_block.input) ? event.content_block.input : {},
							partialJson: "",
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					} else {
						const block: Block = {
							type: "providerNative",
							subtype: event.content_block.type,
							raw: event.content_block,
							index: event.index,
						};
						output.content.push(block);
						// Native blocks are represented in output.content but have no dedicated stream event variant.
					}
				} else if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "text") {
							block.text += event.delta.text;
							stream.push({
								type: "text_delta",
								contentIndex: index,
								delta: event.delta.text,
								partial: output,
							});
						}
					} else if (event.delta.type === "thinking_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinking += event.delta.thinking;
							stream.push({
								type: "thinking_delta",
								contentIndex: index,
								delta: event.delta.thinking,
								partial: output,
							});
						}
					} else if (event.delta.type === "input_json_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "toolCall") {
							block.partialJson += event.delta.partial_json;
							block.arguments = parseStreamingJson(block.partialJson);
							stream.push({
								type: "toolcall_delta",
								contentIndex: index,
								delta: event.delta.partial_json,
								partial: output,
							});
						}
					} else if (event.delta.type === "signature_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinkingSignature = block.thinkingSignature || "";
							block.thinkingSignature += event.delta.signature;
						}
					}
				} else if (event.type === "content_block_stop") {
					const index = blocks.findIndex((b) => b.index === event.index);
					const block = blocks[index];
					if (block) {
						delete block.index;
						if (block.type === "text") {
							stream.push({
								type: "text_end",
								contentIndex: index,
								content: block.text,
								partial: output,
							});
						} else if (block.type === "thinking") {
							stream.push({
								type: "thinking_end",
								contentIndex: index,
								content: block.thinking,
								partial: output,
							});
						} else if (block.type === "toolCall") {
							block.arguments = parseStreamingJson(block.partialJson);
							// Finalize in-place and strip the scratch buffer so replay only
							// carries parsed arguments.
							delete (block as { partialJson?: string }).partialJson;
							stream.push({
								type: "toolcall_end",
								contentIndex: index,
								toolCall: block,
								partial: output,
							});
						}
					}
				} else if (event.type === "message_delta") {
					if (event.delta.stop_reason) {
						const stopReasonResult = mapStopReason(event.delta.stop_reason, event.delta.stop_details);
						output.stopReason = stopReasonResult.stopReason;
						if (stopReasonResult.errorMessage) {
							output.errorMessage = stopReasonResult.errorMessage;
						}
					}
					// Only update usage fields if present (not null).
					// Preserves input_tokens from message_start when proxies omit it in message_delta.
					if (event.usage.input_tokens != null) {
						output.usage.input = event.usage.input_tokens;
					}
					if (event.usage.output_tokens != null) {
						output.usage.output = event.usage.output_tokens;
					}
					if (event.usage.cache_read_input_tokens != null) {
						output.usage.cacheRead = event.usage.cache_read_input_tokens;
					}
					if (event.usage.cache_creation_input_tokens != null) {
						output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
					}
					// Anthropic reports reasoning tokens in `output_tokens_details.thinking_tokens` on the
					// final message_delta usage (a subset of output_tokens). SDK 0.91.1 omits the field from
					// its Usage type, so read it through a narrow cast. Verified against the live API.
					const thinkingTokens = (event.usage as { output_tokens_details?: { thinking_tokens?: number } })
						.output_tokens_details?.thinking_tokens;
					if (thinkingTokens != null) {
						output.usage.reasoning = thinkingTokens;
					}
					// Anthropic doesn't provide total_tokens, compute from components
					output.usage.totalTokens =
						output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
					calculateCost(model, output.usage);
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error(output.errorMessage || "An unknown error occurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				delete (block as { index?: number }).index;
				// partialJson is only a streaming scratch buffer; never persist it.
				delete (block as { partialJson?: string }).partialJson;
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

/**
 * Opus-specific feature checks use provider model ids because those behaviors
 * are model-tier details, not custom-provider compatibility toggles.
 */
function getModelMatchCandidates(model: Pick<Model<"anthropic-messages">, "id" | "name">): string[] {
	return [model.id, model.name].flatMap((value) => {
		const lower = value.toLowerCase();
		return [lower, lower.replace(/[\s_.:]+/g, "-")];
	});
}

function matchesModelMarker(
	model: Pick<Model<"anthropic-messages">, "id" | "name">,
	markers: readonly string[],
): boolean {
	const candidates = getModelMatchCandidates(model);
	return candidates.some((candidate) => markers.some((marker) => candidate.includes(marker)));
}

function isOpus46(model: Pick<Model<"anthropic-messages">, "id" | "name">): boolean {
	return matchesModelMarker(model, ["opus-4-6"]);
}

function isOpus47(model: Pick<Model<"anthropic-messages">, "id" | "name">): boolean {
	return matchesModelMarker(model, ["opus-4-7"]);
}

function supportsAdaptiveThinking(model: Model<"anthropic-messages">): boolean {
	if (model.compat?.forceAdaptiveThinking !== undefined) {
		return model.compat.forceAdaptiveThinking;
	}
	return matchesModelMarker(model, ADAPTIVE_THINKING_MODEL_MARKERS);
}

/**
 * Map ThinkingLevel to Anthropic effort levels for adaptive thinking.
 *
 * Model-specific effort tiers:
 * - Opus 4.7+ and Fable 5: supports "low" | "medium" | "high" | "xhigh" | "max"
 * - Opus 4.6: supports "low" | "medium" | "high" | "max" ("xhigh" maps to "max")
 * - Sonnet 4.6 and other adaptive models: "low" | "medium" | "high" ("xhigh"/"max" clamp to "high")
 */
function mapThinkingLevelToEffort(
	model: Model<"anthropic-messages">,
	level: SimpleStreamOptions["reasoning"],
): AnthropicEffort {
	const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
	if (typeof mapped === "string") return mapped as AnthropicEffort;

	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			if (isOpus47(model)) return "xhigh";
			if (isOpus46(model)) return "max";
			return "high";
		case "max":
			if (isOpus47(model) || isOpus46(model)) return "max";
			return "high";
		default:
			return "high";
	}
}

export const streamSimple: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey;
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, context, options, options?.apiKey);
	if (!options?.reasoning) {
		return stream(model, context, { ...base, thinkingEnabled: false } satisfies AnthropicOptions);
	}

	// For models with adaptive thinking: use an effort level.
	// For older models: use budget-based thinking.
	if (supportsAdaptiveThinking(model)) {
		const effort = mapThinkingLevelToEffort(model, options.reasoning);
		return stream(model, context, {
			...base,
			thinkingEnabled: true,
			effort,
		} satisfies AnthropicOptions);
	}

	// Undefined means the caller did not request an output cap; let the helper use the model cap.
	// Do not coerce to 0 here, or the thinking budget would become the entire max_tokens value.
	const adjusted = adjustMaxTokensForThinking(
		base.maxTokens,
		model.maxTokens,
		options.reasoning,
		options.thinkingBudgets,
	);

	const maxTokens = clampMaxTokensToContext(model, context, adjusted.maxTokens);

	return stream(model, context, {
		...base,
		maxTokens,
		thinkingEnabled: true,
		thinkingBudgetTokens: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024)),
	} satisfies AnthropicOptions);
};

function isOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

function createClient(
	model: Model<"anthropic-messages">,
	apiKey: string,
	interleavedThinking: boolean,
	useFineGrainedToolStreamingBeta: boolean,
	optionsHeaders?: Record<string, string>,
	dynamicHeaders?: Record<string, string>,
	sessionId?: string,
	env?: ProviderEnv,
): { client: Anthropic; isOAuthToken: boolean } {
	// Adaptive thinking models have interleaved thinking built in, so skip the beta header.
	const needsInterleavedBeta = interleavedThinking && !supportsAdaptiveThinking(model);
	const betaFeatures: string[] = [];
	if (useFineGrainedToolStreamingBeta) {
		betaFeatures.push(FINE_GRAINED_TOOL_STREAMING_BETA);
	}
	if (needsInterleavedBeta) {
		betaFeatures.push(INTERLEAVED_THINKING_BETA);
	}

	if (model.provider === "cloudflare-ai-gateway") {
		const client = new Anthropic({
			apiKey: null,
			authToken: null,
			baseURL: resolveCloudflareBaseUrl(model, env),
			dangerouslyAllowBrowser: true,
			defaultHeaders: sanitizeAdaptiveThinkingHeaders(
				model,
				mergeHeaders(
					{
						accept: "application/json",
						"anthropic-dangerous-direct-browser-access": "true",
						"cf-aig-authorization": `Bearer ${apiKey}`,
						"x-api-key": null,
						Authorization: null,
						...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
					},
					model.headers,
					optionsHeaders,
				),
			),
		});

		return { client, isOAuthToken: false };
	}

	// Copilot: Bearer auth, selective betas.
	if (model.provider === "github-copilot") {
		const client = new Anthropic({
			apiKey: null,
			authToken: apiKey,
			baseURL: model.baseUrl,
			dangerouslyAllowBrowser: true,
			defaultHeaders: sanitizeAdaptiveThinkingHeaders(
				model,
				mergeHeaders(
					{
						accept: "application/json",
						"anthropic-dangerous-direct-browser-access": "true",
						...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
					},
					model.headers,
					dynamicHeaders,
					optionsHeaders,
				),
			),
		});

		return { client, isOAuthToken: false };
	}

	// OAuth: Bearer auth, Claude Code identity headers
	if (isOAuthToken(apiKey)) {
		const client = new Anthropic({
			apiKey: null,
			authToken: apiKey,
			baseURL: model.baseUrl,
			dangerouslyAllowBrowser: true,
			defaultHeaders: sanitizeAdaptiveThinkingHeaders(
				model,
				mergeHeaders(
					{
						accept: "application/json",
						"anthropic-dangerous-direct-browser-access": "true",
						"anthropic-beta": ["claude-code-20250219", "oauth-2025-04-20", ...betaFeatures].join(","),
						"user-agent": `claude-cli/${claudeCodeVersion}`,
						"x-app": "cli",
					},
					model.headers,
					optionsHeaders,
				),
			),
		});

		return { client, isOAuthToken: true };
	}

	// API key auth
	const sessionAffinityHeaders: Record<string, string | null> =
		sessionId && getAnthropicCompat(model).sendSessionAffinityHeaders ? { "x-session-affinity": sessionId } : {};
	const client = new Anthropic({
		apiKey,
		authToken: null,
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: sanitizeAdaptiveThinkingHeaders(
			model,
			mergeHeaders(
				{
					accept: "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
					...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
				},
				sessionAffinityHeaders,
				model.headers,
				optionsHeaders,
			),
		),
	});

	return { client, isOAuthToken: false };
}

function buildParams(
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuthToken: boolean,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	const compat = getAnthropicCompat(model);
	const { cacheControl } = getCacheControl(model, options?.cacheRetention ?? model.cacheRetention, options?.env);
	const params: MessageCreateParamsStreaming = {
		model: model.id,
		messages: convertMessages(
			context.messages,
			model,
			isOAuthToken,
			cacheControl,
			options?.thinkingEnabled === true,
			compat.allowEmptySignature,
		),
		max_tokens: options?.maxTokens ?? model.maxTokens,
		stream: true,
	};

	// For OAuth tokens, we MUST include Claude Code identity
	if (isOAuthToken) {
		params.system = [
			{
				type: "text",
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
				...(cacheControl ? { cache_control: cacheControl } : {}),
			},
		];
		if (context.systemPrompt) {
			params.system.push({
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
				...(cacheControl ? { cache_control: cacheControl } : {}),
			});
		}
	} else if (context.systemPrompt) {
		// Add cache control to system prompt for non-OAuth tokens
		params.system = [
			{
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
				...(cacheControl ? { cache_control: cacheControl } : {}),
			},
		];
	}

	// Temperature is incompatible with extended thinking and unsupported on Claude Opus 4.7+.
	if (options?.temperature !== undefined && !options?.thinkingEnabled && compat.supportsTemperature) {
		Object.defineProperty(params, "temperature", {
			value: options.temperature,
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}

	if (context.tools && context.tools.length > 0) {
		params.tools = convertTools(
			context.tools,
			isOAuthToken,
			compat.supportsEagerToolInputStreaming,
			compat.supportsCacheControlOnTools ? cacheControl : undefined,
		);
	}

	// Configure thinking mode: adaptive, budget-based, or explicitly disabled.
	if (model.reasoning) {
		if (options?.thinkingEnabled) {
			// Default to "summarized" so Opus 4.7 and Mythos Preview behave like
			// older Claude 4 models (whose API default is also "summarized").
			const display: AnthropicThinkingDisplay = options.thinkingDisplay ?? "summarized";
			if (supportsAdaptiveThinking(model)) {
				// Adaptive thinking: Claude decides when and how much to think.
				params.thinking = { type: "adaptive", display } as MessageCreateParamsStreaming["thinking"];
				if (options.effort) {
					// The Anthropic SDK types can lag newly supported effort values such as "xhigh" and "max".
					params.output_config = { effort: options.effort } as NonNullable<
						MessageCreateParamsStreaming["output_config"]
					>;
				}
			} else {
				// Budget-based thinking for older models
				params.thinking = {
					type: "enabled",
					budget_tokens: options.thinkingBudgetTokens || 1024,
					display,
				} as MessageCreateParamsStreaming["thinking"];
			}
		} else if (
			options?.thinkingEnabled === false &&
			compat.supportsDisabledThinking &&
			model.thinkingLevelMap?.off !== null
		) {
			params.thinking = { type: "disabled" };
		}
	}

	if (options?.metadata) {
		const userId = options.metadata.user_id;
		if (typeof userId === "string") {
			params.metadata = { user_id: userId };
		}
	}

	if (options?.toolChoice && compat.supportsToolChoice) {
		const isForcedToolChoice = options.toolChoice === "any" || typeof options.toolChoice === "object";
		if (!isForcedToolChoice || compat.supportsForcedToolChoice) {
			if (typeof options.toolChoice === "string") {
				params.tool_choice = { type: options.toolChoice };
			} else {
				params.tool_choice = options.toolChoice;
			}
		}
	}

	applyExtraBodyToAnthropicParams(params, options?.extraBody);

	return params;
}

function applyExtraBodyToAnthropicParams(
	params: MessageCreateParamsStreaming,
	extraBody: Record<string, unknown> | undefined,
): void {
	if (!extraBody) return;
	for (const [key, value] of Object.entries(extraBody)) {
		if (ANTHROPIC_RESERVED_BODY_KEYS.has(key)) continue;
		Object.defineProperty(params, key, { value, writable: true, enumerable: true, configurable: true });
	}
}

// Normalize tool call IDs to match Anthropic's required pattern and length
function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function convertMessages(
	messages: Message[],
	model: Model<"anthropic-messages">,
	isOAuthToken: boolean,
	cacheControl?: CacheControlEphemeral,
	preserveThinking = true,
	allowEmptySignature = false,
): MessageParam[] {
	const params: MessageParam[] = [];

	// Transform messages for cross-provider compatibility
	const transformedMessages = transformMessages(messages, model, normalizeToolCallId, {
		preserveThinking,
		preserveUnsignedThinking: true,
	});

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					params.push({
						role: "user",
						content: sanitizeSurrogates(msg.content),
					});
				}
			} else {
				const blocks: ContentBlockParam[] = msg.content.map((item) => {
					if (item.type === "text") {
						return {
							type: "text",
							text: sanitizeSurrogates(item.text),
						};
					} else {
						return {
							type: "image",
							source: {
								type: "base64",
								media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
								data: item.data,
							},
						};
					}
				});
				const filteredBlocks = blocks.filter((b) => {
					if (b.type === "text") {
						return b.text.trim().length > 0;
					}
					return true;
				});
				if (filteredBlocks.length === 0) continue;
				params.push({
					role: "user",
					content: filteredBlocks,
				});
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];
			const isSameModel = msg.provider === model.provider && msg.api === model.api && msg.model === model.id;

			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({
						type: "text",
						text: sanitizeSurrogates(block.text),
					});
				} else if (block.type === "thinking") {
					// Redacted thinking: pass the opaque payload back as redacted_thinking
					if (block.redacted) {
						blocks.push({
							type: "redacted_thinking",
							data: block.thinkingSignature!,
						});
						continue;
					}
					if (block.thinking.trim().length === 0) continue;
					// If thinking signature is missing/empty (e.g., from aborted stream),
					// convert to plain text for Anthropic. Some compatible providers emit
					// and accept empty signatures, so let marked models preserve the block.
					if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
						blocks.push(
							allowEmptySignature
								? {
										type: "thinking",
										thinking: sanitizeSurrogates(block.thinking),
										signature: "",
									}
								: {
										type: "text",
										text: sanitizeSurrogates(block.thinking),
									},
						);
					} else {
						blocks.push({
							type: "thinking",
							thinking: block.thinking,
							signature: block.thinkingSignature,
						});
					}
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: block.id,
						name: isOAuthToken ? toClaudeCodeName(block.name) : block.name,
						input: block.arguments ?? {},
					});
				} else if (block.type === "providerNative") {
					if (isSameModel && isReplayableAnthropicProviderNativeBlock(block.raw)) {
						blocks.push(block.raw);
					}
				}
			}
			if (blocks.length === 0) continue;
			params.push({
				role: "assistant",
				content: blocks,
			});
		} else if (msg.role === "toolResult") {
			// Collect all consecutive toolResult messages, needed for z.ai Anthropic endpoint
			const toolResults: ContentBlockParam[] = [];

			// Add the current tool result
			toolResults.push({
				type: "tool_result",
				tool_use_id: msg.toolCallId,
				content: convertContentBlocks(msg.content),
				is_error: msg.isError,
			});

			// Look ahead for consecutive toolResult messages
			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage; // We know it's a toolResult
				toolResults.push({
					type: "tool_result",
					tool_use_id: nextMsg.toolCallId,
					content: convertContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}

			// Skip the messages we've already processed
			i = j - 1;

			// Add a single user message with all tool results
			params.push({
				role: "user",
				content: toolResults,
			});
		}
	}

	// Add cache_control to the last user message to cache conversation history
	if (cacheControl && params.length > 0) {
		const lastMessage = params[params.length - 1];
		if (lastMessage.role === "user") {
			if (Array.isArray(lastMessage.content)) {
				const lastBlock = lastMessage.content[lastMessage.content.length - 1];
				if (isCacheableUserContentBlock(lastBlock)) {
					lastBlock.cache_control = cacheControl;
				}
			} else if (typeof lastMessage.content === "string") {
				lastMessage.content = [
					{
						type: "text",
						text: lastMessage.content,
						cache_control: cacheControl,
					},
				];
			}
		}
	}

	return params;
}

function shouldUseFineGrainedToolStreamingBeta(model: Model<"anthropic-messages">, context: Context): boolean {
	return !!context.tools?.length && !getAnthropicCompat(model).supportsEagerToolInputStreaming;
}

function convertTools(
	tools: Tool[],
	isOAuthToken: boolean,
	supportsEagerToolInputStreaming: boolean,
	cacheControl?: CacheControlEphemeral,
): Anthropic.Messages.Tool[] {
	if (!tools) return [];

	return tools.map((tool, index) => {
		const schema = tool.parameters as { properties?: unknown; required?: string[] };

		return {
			name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
			description: tool.description,
			...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
			input_schema: {
				type: "object",
				properties: schema.properties ?? {},
				required: schema.required ?? [],
			},
			...(cacheControl && index === tools.length - 1 ? { cache_control: cacheControl } : {}),
		};
	});
}

function mapStopReason(
	reason: Anthropic.Messages.StopReason | string,
	stopDetails?: RefusalStopDetails | null,
): { stopReason: StopReason; errorMessage?: string } {
	switch (reason) {
		case "end_turn":
			return { stopReason: "stop" };
		case "max_tokens":
			return { stopReason: "length" };
		case "tool_use":
			return { stopReason: "toolUse" };
		case "refusal":
			return {
				stopReason: "error",
				errorMessage: stopDetails?.explanation || `The model refused to complete the request`,
			};
		case "pause_turn": // Stop is good enough -> resubmit
			return { stopReason: "stop" };
		case "stop_sequence":
			return { stopReason: "stop" }; // We don't supply stop sequences, so this should never happen
		case "sensitive": // Content flagged by safety filters (not yet in SDK types)
			return { stopReason: "error" };
		default:
			// Handle unknown stop reasons gracefully (API may add new values)
			throw new Error(`Unhandled stop reason: ${reason}`);
	}
}
