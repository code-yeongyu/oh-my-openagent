import OpenAI from "openai";
import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { clampThinkingLevel, supportsXhigh } from "../models.ts";
import type {
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	Model,
	OpenAIResponsesCompat,
	ProviderEnv,
	ProviderHeaders,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	Usage,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { isCloudflareProvider, resolveCloudflareBaseUrl } from "./cloudflare.ts";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./github-copilot-headers.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import { convertResponsesMessages, convertResponsesTools, processResponsesStream } from "./openai-responses-shared.ts";
import { buildBaseOptions, clampMaxForOpenAI, OPENAI_RESPONSES_RESERVED_BODY_KEYS } from "./simple-options.ts";

const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
const OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";
const OPENAI_WEB_SEARCH_SOURCES_INCLUDE = "web_search_call.action.sources";
const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;

type WebSocketEventType = "open" | "message" | "error" | "close";
type WebSocketListener = (event: unknown) => void;

interface WebSocketLike {
	close(code?: number, reason?: string): void;
	send(data: string): void;
	addEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
	removeEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
}

interface CachedWebSocketConnection {
	socket: WebSocketLike;
	busy: boolean;
	idleTimer?: ReturnType<typeof setTimeout>;
}

type WebSocketConstructor = new (
	url: string,
	protocols?: string | string[] | { headers?: Record<string, string> },
) => WebSocketLike;

type MutableResponsesPayload = ResponseCreateParamsStreaming & {
	include?: unknown[];
	tool_choice?: unknown;
	tools?: unknown[];
};

const websocketSessionCache = new Map<string, CachedWebSocketConnection>();

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
	if (!headers) return false;
	const expected = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === expected && value !== null && value.trim().length > 0) return true;
	}
	return false;
}

function getClientApiKey(provider: string, apiKey: string | undefined, headers: ProviderHeaders | undefined): string {
	if (apiKey) return apiKey;
	if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization")) return "unused";
	throw new Error(`No API key for provider: ${provider}`);
}

/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention?: CacheRetention, env?: ProviderEnv): CacheRetention {
	if (cacheRetention) {
		return cacheRetention;
	}
	if (getProviderEnvValue("PI_CACHE_RETENTION", env) === "long") {
		return "long";
	}
	return "short";
}

function getCompat(model: Model<"openai-responses">, env?: ProviderEnv): Required<OpenAIResponsesCompat> {
	const isNativeEndpoint = isOpenAIResponsesNativeEndpoint(model, env);
	return {
		supportsDeveloperRole: model.compat?.supportsDeveloperRole ?? true,
		sendSessionIdHeader: model.compat?.sendSessionIdHeader ?? true,
		supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
		supportsWebSocket: model.compat?.supportsWebSocket ?? isNativeEndpoint,
		supportsWebSearchPreview: model.compat?.supportsWebSearchPreview ?? isNativeEndpoint,
	};
}

function isOpenAIResponsesNativeEndpoint(model: Model<"openai-responses">, env?: ProviderEnv): boolean {
	const baseUrl = isCloudflareProvider(model.provider) ? resolveCloudflareBaseUrl(model, env) : model.baseUrl;
	try {
		return new URL(baseUrl || "https://api.openai.com/v1").hostname === "api.openai.com";
	} catch {
		return false;
	}
}

function getPromptCacheRetention(
	compat: Required<OpenAIResponsesCompat>,
	cacheRetention: CacheRetention,
): "24h" | undefined {
	return cacheRetention === "long" && compat.supportsLongCacheRetention ? "24h" : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isOpenAiWebSearchPreviewTool(value: unknown): boolean {
	return isRecord(value) && (value.type === "web_search_preview" || value.type === "web_search_preview_2025_03_11");
}

function sanitizeUnsupportedNativeTools(
	params: ResponseCreateParamsStreaming,
	compat: Required<OpenAIResponsesCompat>,
): ResponseCreateParamsStreaming {
	if (compat.supportsWebSearchPreview) {
		return params;
	}

	const payload = params as MutableResponsesPayload;
	let sanitized: MutableResponsesPayload | undefined;
	const nextPayload = (): MutableResponsesPayload => {
		sanitized ??= { ...payload };
		return sanitized;
	};

	if (Array.isArray(payload.tools)) {
		const tools = payload.tools.filter((tool) => !isOpenAiWebSearchPreviewTool(tool));
		if (tools.length !== payload.tools.length) {
			const next = nextPayload();
			if (tools.length > 0) {
				next.tools = tools;
			} else {
				delete next.tools;
			}
		}
	}

	if (Array.isArray(payload.include)) {
		const include = payload.include.filter((value) => value !== OPENAI_WEB_SEARCH_SOURCES_INCLUDE);
		if (include.length !== payload.include.length) {
			const next = nextPayload();
			if (include.length > 0) {
				next.include = include;
			} else {
				delete next.include;
			}
		}
	}

	if (isOpenAiWebSearchPreviewTool(payload.tool_choice)) {
		delete nextPayload().tool_choice;
	}

	return sanitized ? (sanitized as ResponseCreateParamsStreaming) : params;
}

function formatOpenAIResponsesError(error: unknown): string {
	return formatProviderError(normalizeProviderError(error), "OpenAI API error");
}

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
	serviceTier?: ResponseCreateParamsStreaming["service_tier"];
}

/**
 * Generate function for OpenAI Responses API
 */
export const stream: StreamFunction<"openai-responses", OpenAIResponsesOptions> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	// Start async processing
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
			const apiKey = getClientApiKey(model.provider, options?.apiKey, options?.headers);
			const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
			const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
			const client = createClient(model, context, apiKey, options?.headers, cacheSessionId, options?.env);
			let params = buildParams(model, context, options);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== undefined) {
				params = nextParams as ResponseCreateParamsStreaming;
			}

			const compat = getCompat(model, options?.env);
			params = sanitizeUnsupportedNativeTools(params, compat);
			const transport = options?.transport ?? "sse";
			if (transport !== "sse" && compat.supportsWebSocket) {
				let websocketStarted = false;
				try {
					await processWebSocketStream(
						resolveOpenAIResponsesWebSocketUrl(model, options?.env),
						params,
						buildWebSocketHeaders(model, context, apiKey, options?.headers, cacheSessionId),
						output,
						stream,
						model,
						() => {
							websocketStarted = true;
						},
						options,
					);

					if (options?.signal?.aborted) {
						throw new Error("Request was aborted");
					}

					stream.push({ type: "done", reason: getDoneReason(output.stopReason), message: output });
					stream.end();
					return;
				} catch (error) {
					if (transport === "websocket" || websocketStarted) {
						throw error;
					}
				}
			}

			const requestOptions = {
				...(options?.signal ? { signal: options.signal } : {}),
				...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
				maxRetries: options?.maxRetries ?? 0,
			};
			const { data: openaiStream, response } = await client.responses.create(params, requestOptions).withResponse();
			await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
			stream.push({ type: "start", partial: output });

			await processResponsesStream(openaiStream, output, stream, model, {
				serviceTier: options?.serviceTier,
				applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model),
			});

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
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
			output.errorMessage = formatOpenAIResponsesError(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimple: StreamFunction<"openai-responses", SimpleStreamOptions> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	getClientApiKey(model.provider, options?.apiKey, options?.headers);

	const base = buildBaseOptions(model, context, options, options?.apiKey);
	const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
	const reasoningEffort =
		clampedReasoning === "off" ? undefined : clampMaxForOpenAI(clampedReasoning, supportsXhigh(model));

	return stream(model, context, {
		...base,
		reasoningEffort,
	} satisfies OpenAIResponsesOptions);
};

function createClient(
	model: Model<"openai-responses">,
	context: Context,
	apiKey: string,
	optionsHeaders?: ProviderHeaders,
	sessionId?: string,
	env?: ProviderEnv,
) {
	const compat = getCompat(model, env);
	const headers: ProviderHeaders = { ...model.headers };
	if (model.provider === "github-copilot") {
		const hasImages = hasCopilotVisionInput(context.messages);
		const copilotHeaders = buildCopilotDynamicHeaders({
			messages: context.messages,
			hasImages,
		});
		Object.assign(headers, copilotHeaders);
	}

	if (sessionId) {
		if (compat.sendSessionIdHeader) {
			headers.session_id = sessionId;
		}
		headers["x-client-request-id"] = sessionId;
	}

	// Merge options headers last so they can override defaults
	if (optionsHeaders) {
		Object.assign(headers, optionsHeaders);
	}

	return new OpenAI({
		apiKey,
		baseURL: isCloudflareProvider(model.provider) ? resolveCloudflareBaseUrl(model, env) : model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers,
	});
}

function buildParams(model: Model<"openai-responses">, context: Context, options?: OpenAIResponsesOptions) {
	const reasoningRequested = options?.reasoningEffort !== undefined || !!options?.reasoningSummary;
	const messages = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
		preserveThinking: reasoningRequested,
	});

	const cacheRetention = resolveCacheRetention(options?.cacheRetention ?? model.cacheRetention, options?.env);
	const compat = getCompat(model, options?.env);
	const params: ResponseCreateParamsStreaming = {
		model: model.id,
		input: messages,
		stream: true,
		prompt_cache_key: cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId),
		prompt_cache_retention: getPromptCacheRetention(compat, cacheRetention),
		store: false,
	};

	if (options?.maxTokens) {
		params.max_output_tokens = options?.maxTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options?.temperature;
	}

	if (options?.serviceTier !== undefined) {
		params.service_tier = options.serviceTier;
	}

	if (context.tools && context.tools.length > 0) {
		params.tools = convertResponsesTools(context.tools);
	}

	if (model.reasoning) {
		if (reasoningRequested) {
			const effort = options?.reasoningEffort
				? (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort)
				: "medium";
			params.reasoning = {
				effort: effort as NonNullable<typeof params.reasoning>["effort"],
				summary: options?.reasoningSummary || "auto",
			};
			params.include = ["reasoning.encrypted_content"];
		} else if (model.provider !== "github-copilot" && model.thinkingLevelMap?.off !== null) {
			params.reasoning = {
				effort: (model.thinkingLevelMap?.off ?? "none") as NonNullable<typeof params.reasoning>["effort"],
			};
		}
	}

	applyExtraBodyToResponsesParams(params, options?.extraBody);

	return params;
}

function applyExtraBodyToResponsesParams(
	params: ResponseCreateParamsStreaming,
	extraBody: Record<string, unknown> | undefined,
): void {
	if (!extraBody) return;
	for (const [key, value] of Object.entries(extraBody)) {
		if (OPENAI_RESPONSES_RESERVED_BODY_KEYS.has(key)) continue;
		Object.defineProperty(params, key, { value, writable: true, enumerable: true, configurable: true });
	}
}

function getDoneReason(stopReason: AssistantMessage["stopReason"]): "stop" | "length" | "toolUse" {
	if (stopReason === "length" || stopReason === "toolUse") return stopReason;
	return "stop";
}

function getWebSocketConstructor(): WebSocketConstructor | null {
	const wsConstructor = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
	return typeof wsConstructor === "function" ? wsConstructor : null;
}

function getWebSocketReadyState(socket: WebSocketLike): number | undefined {
	const readyState = (socket as { readyState?: number }).readyState;
	return typeof readyState === "number" ? readyState : undefined;
}

function isWebSocketReusable(socket: WebSocketLike): boolean {
	const readyState = getWebSocketReadyState(socket);
	return readyState === undefined || readyState === 1;
}

function closeWebSocketSilently(socket: WebSocketLike, code = 1000, reason = "done"): void {
	try {
		socket.close(code, reason);
	} catch {}
}

function scheduleSessionWebSocketExpiry(sessionId: string, entry: CachedWebSocketConnection): void {
	if (entry.idleTimer) {
		clearTimeout(entry.idleTimer);
	}
	entry.idleTimer = setTimeout(() => {
		if (entry.busy) return;
		closeWebSocketSilently(entry.socket, 1000, "idle_timeout");
		websocketSessionCache.delete(sessionId);
	}, SESSION_WEBSOCKET_CACHE_TTL_MS);
	const unref = (entry.idleTimer as { unref?: () => void }).unref;
	if (unref) unref.call(entry.idleTimer);
}

async function connectWebSocket(url: string, headers: Headers, signal?: AbortSignal): Promise<WebSocketLike> {
	const WebSocketConstructorValue = getWebSocketConstructor();
	if (!WebSocketConstructorValue) {
		throw new Error("WebSocket transport is not available in this runtime");
	}

	const websocketHeaders = headersToRecord(headers);

	return new Promise<WebSocketLike>((resolve, reject) => {
		let settled = false;
		let socket: WebSocketLike;

		const cleanup = () => {
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
			socket.removeEventListener("close", onClose);
			signal?.removeEventListener("abort", onAbort);
		};
		const settleReject = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onOpen: WebSocketListener = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(socket);
		};
		const onError: WebSocketListener = (event) => {
			settleReject(extractWebSocketError(event));
		};
		const onClose: WebSocketListener = (event) => {
			settleReject(extractWebSocketCloseError(event));
		};
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			closeWebSocketSilently(socket, 1000, "aborted");
			reject(new Error("Request was aborted"));
		};

		try {
			socket = new WebSocketConstructorValue(url, { headers: websocketHeaders });
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}

		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
		signal?.addEventListener("abort", onAbort);
	});
}

async function acquireWebSocket(
	url: string,
	headers: Headers,
	sessionId: string | undefined,
	signal?: AbortSignal,
): Promise<{ socket: WebSocketLike; release: (options?: { keep?: boolean }) => void }> {
	if (!sessionId) {
		const socket = await connectWebSocket(url, headers, signal);
		return { socket, release: () => closeWebSocketSilently(socket) };
	}

	const cached = websocketSessionCache.get(sessionId);
	if (cached) {
		if (cached.idleTimer) {
			clearTimeout(cached.idleTimer);
			cached.idleTimer = undefined;
		}
		if (!cached.busy && isWebSocketReusable(cached.socket)) {
			cached.busy = true;
			return {
				socket: cached.socket,
				release: ({ keep } = {}) => {
					if (!keep || !isWebSocketReusable(cached.socket)) {
						closeWebSocketSilently(cached.socket);
						websocketSessionCache.delete(sessionId);
						return;
					}
					cached.busy = false;
					scheduleSessionWebSocketExpiry(sessionId, cached);
				},
			};
		}
		if (!cached.busy) {
			closeWebSocketSilently(cached.socket);
			websocketSessionCache.delete(sessionId);
		}
	}

	const socket = await connectWebSocket(url, headers, signal);
	const entry: CachedWebSocketConnection = { socket, busy: true };
	websocketSessionCache.set(sessionId, entry);
	return {
		socket,
		release: ({ keep } = {}) => {
			if (!keep || !isWebSocketReusable(entry.socket)) {
				closeWebSocketSilently(entry.socket);
				if (entry.idleTimer) clearTimeout(entry.idleTimer);
				if (websocketSessionCache.get(sessionId) === entry) {
					websocketSessionCache.delete(sessionId);
				}
				return;
			}
			entry.busy = false;
			scheduleSessionWebSocketExpiry(sessionId, entry);
		},
	};
}

function extractWebSocketError(event: unknown): Error {
	if (event && typeof event === "object" && "message" in event) {
		const message = (event as { message?: string }).message;
		if (typeof message === "string" && message.length > 0) {
			return new Error(message);
		}
	}
	return new Error("WebSocket error");
}

function extractWebSocketCloseError(event: unknown): Error {
	if (event && typeof event === "object") {
		const code = "code" in event ? (event as { code?: number }).code : undefined;
		const reason = "reason" in event ? (event as { reason?: string }).reason : undefined;
		const codeText = typeof code === "number" ? ` ${code}` : "";
		const reasonText = typeof reason === "string" && reason.length > 0 ? ` ${reason}` : "";
		return new Error(`WebSocket closed${codeText}${reasonText}`.trim());
	}
	return new Error("WebSocket closed");
}

async function decodeWebSocketData(data: unknown): Promise<string | null> {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) {
		return new TextDecoder().decode(new Uint8Array(data));
	}
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	}
	if (data && typeof data === "object" && "arrayBuffer" in data) {
		const arrayBuffer = await (data as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
		return new TextDecoder().decode(new Uint8Array(arrayBuffer));
	}
	return null;
}

async function* parseWebSocket(socket: WebSocketLike, signal?: AbortSignal): AsyncGenerator<ResponseStreamEvent> {
	const queue: ResponseStreamEvent[] = [];
	let pending: (() => void) | null = null;
	let done = false;
	let failed: Error | null = null;
	let sawCompletion = false;

	const wake = () => {
		if (!pending) return;
		const resolve = pending;
		pending = null;
		resolve();
	};
	const onMessage: WebSocketListener = (event) => {
		void (async () => {
			if (!event || typeof event !== "object" || !("data" in event)) return;
			const text = await decodeWebSocketData((event as { data?: unknown }).data);
			if (!text) return;
			try {
				const parsed = JSON.parse(text) as ResponseStreamEvent;
				if (parsed.type === "response.completed" || parsed.type === "response.incomplete") {
					sawCompletion = true;
					done = true;
				}
				queue.push(parsed);
				wake();
			} catch {}
		})();
	};
	const onError: WebSocketListener = (event) => {
		failed = extractWebSocketError(event);
		done = true;
		wake();
	};
	const onClose: WebSocketListener = (event) => {
		if (!sawCompletion && !failed) {
			failed = extractWebSocketCloseError(event);
		}
		done = true;
		wake();
	};
	const onAbort = () => {
		failed = new Error("Request was aborted");
		done = true;
		wake();
	};

	socket.addEventListener("message", onMessage);
	socket.addEventListener("error", onError);
	socket.addEventListener("close", onClose);
	signal?.addEventListener("abort", onAbort);
	try {
		while (true) {
			if (signal?.aborted) throw new Error("Request was aborted");
			if (queue.length > 0) {
				const event = queue.shift();
				if (event) yield event;
				continue;
			}
			if (done) break;
			await new Promise<void>((resolve) => {
				pending = resolve;
			});
		}
		if (failed) throw failed;
		if (!sawCompletion) throw new Error("WebSocket stream closed before response.completed");
	} finally {
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("error", onError);
		socket.removeEventListener("close", onClose);
		signal?.removeEventListener("abort", onAbort);
	}
}

async function processWebSocketStream(
	url: string,
	params: ResponseCreateParamsStreaming,
	headers: Headers,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"openai-responses">,
	onStart: () => void,
	options?: OpenAIResponsesOptions,
): Promise<void> {
	const { socket, release } = await acquireWebSocket(url, headers, options?.sessionId, options?.signal);
	try {
		socket.send(JSON.stringify({ type: "response.create", ...params }));
		onStart();
		await options?.onResponse?.({ status: 101, headers: {} }, model);
		stream.push({ type: "start", partial: output });
		await processResponsesStream(parseWebSocket(socket, options?.signal), output, stream, model, {
			serviceTier: options?.serviceTier,
			applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model),
		});
	} finally {
		release({ keep: false });
	}
}

function resolveOpenAIResponsesWebSocketUrl(model: Model<"openai-responses">, env?: ProviderEnv): string {
	const baseUrl = isCloudflareProvider(model.provider)
		? resolveCloudflareBaseUrl(model, env)
		: model.baseUrl || "https://api.openai.com/v1";
	const url = new URL(baseUrl);
	if (!url.pathname.endsWith("/responses")) {
		url.pathname = `${url.pathname.replace(/\/$/, "")}/responses`;
	}
	if (url.protocol === "https:") url.protocol = "wss:";
	else if (url.protocol === "http:") url.protocol = "ws:";
	return url.toString();
}

function buildWebSocketHeaders(
	model: Model<"openai-responses">,
	context: Context,
	apiKey: string,
	optionsHeaders?: ProviderHeaders,
	sessionId?: string,
): Headers {
	const headers = new Headers(model.headers);
	if (model.provider === "github-copilot") {
		const hasImages = hasCopilotVisionInput(context.messages);
		const copilotHeaders = buildCopilotDynamicHeaders({ messages: context.messages, hasImages });
		for (const [key, value] of Object.entries(copilotHeaders)) {
			headers.set(key, value);
		}
	}
	for (const [key, value] of Object.entries(optionsHeaders || {})) {
		if (value === null) {
			headers.delete(key);
		} else {
			headers.set(key, value);
		}
	}
	if (!headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${apiKey}`);
	}
	if (sessionId) {
		const compat = getCompat(model);
		if (compat.sendSessionIdHeader) {
			headers.set("session_id", sessionId);
		}
		headers.set("x-client-request-id", sessionId);
	}
	headers.delete("accept");
	headers.delete("content-type");
	headers.delete("OpenAI-Beta");
	headers.delete("openai-beta");
	headers.set("OpenAI-Beta", OPENAI_BETA_RESPONSES_WEBSOCKETS);
	return headers;
}

function getServiceTierCostMultiplier(
	model: Pick<Model<"openai-responses">, "id">,
	serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
): number {
	switch (serviceTier) {
		case "flex":
			return 0.5;
		case "priority":
			return model.id === "gpt-5.5" ? 2.5 : 2;
		default:
			return 1;
	}
}

function applyServiceTierPricing(
	usage: Usage,
	serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
	model: Pick<Model<"openai-responses">, "id">,
) {
	const multiplier = getServiceTierCostMultiplier(model, serviceTier);
	if (multiplier === 1) return;

	usage.cost.input *= multiplier;
	usage.cost.output *= multiplier;
	usage.cost.cacheRead *= multiplier;
	usage.cost.cacheWrite *= multiplier;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
