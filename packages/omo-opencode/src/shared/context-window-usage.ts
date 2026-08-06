import type { PluginInput } from "@opencode-ai/plugin";
import {
	resolveActualContextLimit,
	type ContextLimitModelCacheState,
} from "./context-limit-resolver"
import type {
	ContextWindowUsage,
	ContextWindowUsageClient,
} from "./dynamic-truncator-types"
import { log } from "./logger"
import { normalizeSDKResponse } from "./normalize-sdk-response"

// Hard ceiling on how long `session.messages()` is allowed to block inside
// `fetchContextWindowUsage`. Without it, a stuck OpenCode RPC (observed when
// `session.processor` enters an "Aborted process" loop) would leave the cached
// promise pending forever and every hook that calls `truncator.truncate(...)`
// would hang on it (issue #4086).
export const DEFAULT_CONTEXT_WINDOW_USAGE_FETCH_TIMEOUT_MS = 5_000;

declare function setTimeout(callback: () => void, delay?: number): ReturnType<typeof globalThis.setTimeout>
declare function clearTimeout(timeout: ReturnType<typeof globalThis.setTimeout>): void

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

const usageCacheByClient = new WeakMap<object, Map<string, Map<string, Promise<ContextWindowUsage | null>>>>()

// Test-only override for the fetch timeout used by `fetchContextWindowUsage`.
// `undefined` means "use the production default".
let contextWindowUsageFetchTimeoutMsForTesting: number | undefined = undefined

export function _setContextWindowUsageFetchTimeoutMsForTesting(
	ms: number | undefined,
): void {
	contextWindowUsageFetchTimeoutMsForTesting = ms
}

function createModelCacheKey(modelCacheState?: ContextLimitModelCacheState): string {
	if (!modelCacheState) {
		return "default"
	}

	const cachedLimits = modelCacheState.modelContextLimitsCache
		? [...modelCacheState.modelContextLimitsCache.entries()]
			.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
			.map(([modelKey, limit]) => `${modelKey}:${limit}`)
			.join(",")
		: ""

	return `${modelCacheState.anthropicContext1MEnabled ? "1m" : "200k"}|${cachedLimits}`
}

function getUsageCache(
	client: ContextWindowUsageClient,
	modelCacheState?: ContextLimitModelCacheState,
): Map<string, Promise<ContextWindowUsage | null>> {
	let cacheByModelState = usageCacheByClient.get(client)
	if (!cacheByModelState) {
		cacheByModelState = new Map()
		usageCacheByClient.set(client, cacheByModelState)
	}

	const modelCacheKey = createModelCacheKey(modelCacheState)
	let cache = cacheByModelState.get(modelCacheKey)
	if (!cache) {
		cache = new Map()
		cacheByModelState.set(modelCacheKey, cache)
	}

	return cache
}

export function invalidateContextWindowUsageCache(ctx: PluginInput, sessionID?: string): void {
	const cacheByModelState = usageCacheByClient.get(ctx.client)
	if (!cacheByModelState) {
		return
	}

	for (const cache of cacheByModelState.values()) {
		if (sessionID) {
			cache.delete(sessionID)
		} else {
			cache.clear()
		}
	}
}

export async function getContextWindowUsage(
	ctx: PluginInput,
	sessionID: string,
	modelCacheState?: ContextLimitModelCacheState,
): Promise<ContextWindowUsage | null> {
	const cache = getUsageCache(ctx.client, modelCacheState)
	const cached = cache.get(sessionID)
	if (cached) {
		return cached
	}

	const usagePromise = fetchContextWindowUsage(ctx, sessionID, modelCacheState)
	cache.set(sessionID, usagePromise)
	return usagePromise
}

function withFetchTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
	if (timeoutMs <= 0) {
		return operation
	}
	let timeoutID: ReturnType<typeof globalThis.setTimeout> | undefined
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutID = setTimeout(
			() =>
				reject(
					new Error(
						`[dynamic-truncator] session.messages timed out after ${timeoutMs}ms`,
					),
				),
			timeoutMs,
		)
	})
	return Promise.race([operation, timeoutPromise]).finally(() => {
		if (timeoutID !== undefined) clearTimeout(timeoutID)
	})
}

async function fetchContextWindowUsage(
	ctx: PluginInput,
	sessionID: string,
	modelCacheState?: ContextLimitModelCacheState,
): Promise<ContextWindowUsage | null> {
	const fetchTimeoutMs =
		contextWindowUsageFetchTimeoutMsForTesting ?? DEFAULT_CONTEXT_WINDOW_USAGE_FETCH_TIMEOUT_MS
	try {
		const response = await withFetchTimeout(
			ctx.client.session.messages({
				path: { id: sessionID },
			}),
			fetchTimeoutMs,
		);

		const messages = normalizeSDKResponse(response, [] as MessageWrapper[], { preferResponseOnMissingData: true })

		const assistantMessages = messages
			.filter((m) => m.info.role === "assistant")
			.map((m) => m.info as AssistantMessageInfo);

		if (assistantMessages.length === 0) return null;

		const lastAssistant = assistantMessages[assistantMessages.length - 1];
		const lastTokens = lastAssistant?.tokens;
		if (!lastAssistant || !lastTokens) return null;

		const actualLimit =
			lastAssistant.providerID !== undefined
				? resolveActualContextLimit(
					lastAssistant.providerID,
					lastAssistant.modelID ?? "",
					modelCacheState,
				)
				: null;

		if (!actualLimit) return null;

		const usedTokens =
			(lastTokens?.input ?? 0) +
			(lastTokens?.cache?.read ?? 0) +
			(lastTokens?.output ?? 0);
		const remainingTokens = actualLimit - usedTokens;

		return {
			usedTokens,
			remainingTokens,
			usagePercentage: usedTokens / actualLimit,
		};
	} catch (error) {
		log("[dynamic-truncator] fetchContextWindowUsage failed; falling back to null", {
			sessionID,
			error: error instanceof Error ? error.message : String(error),
		})
		return null;
	}
}
