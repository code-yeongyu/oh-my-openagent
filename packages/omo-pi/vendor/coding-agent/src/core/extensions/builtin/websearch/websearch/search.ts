import { buildSearchRequest, normalizeSearchResponse } from "./providers.ts";
import type {
	JsonObject,
	RoutingStrategy,
	SearchAttempt,
	SearchDetails,
	SearchProviderEntry,
	SearchRequest,
	WebsearchConfig,
} from "./types.ts";

export { formatSearchText } from "./search-format.ts";

const MAX_ERROR_DETAIL_LENGTH = 500;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function extractErrorDetail(payload: unknown, bodyText: string): string {
	if (isJsonObject(payload)) {
		const obj = payload;
		const error = obj.error;
		if (typeof error === "string" && error.length > 0) return truncate(error, MAX_ERROR_DETAIL_LENGTH);
		if (isJsonObject(error)) {
			const message = error.message;
			if (typeof message === "string" && message.length > 0) return truncate(message, MAX_ERROR_DETAIL_LENGTH);
		}
		const message = obj.message;
		if (typeof message === "string" && message.length > 0) return truncate(message, MAX_ERROR_DETAIL_LENGTH);
	}
	const trimmed = bodyText.trim();
	if (!trimmed) return "";
	return truncate(trimmed, MAX_ERROR_DETAIL_LENGTH);
}

function httpErrorMessage(status: number, payload: unknown, bodyText: string): string {
	const detail = extractErrorDetail(payload, bodyText);
	return detail ? `Search failed with HTTP ${status}: ${detail}` : `Search failed with HTTP ${status}`;
}

export interface SearchRoutingState {
	roundRobinCursor: number;
	successCounts: number[];
}

export function createSearchRoutingState(providerCount: number): SearchRoutingState {
	return { roundRobinCursor: 0, successCounts: Array.from({ length: providerCount }, () => 0) };
}

function entryLabel(entry: Pick<SearchProviderEntry, "provider" | "id"> | SearchAttempt): string {
	if ("entryId" in entry && entry.entryId) return `${entry.provider}/${entry.entryId}`;
	if ("id" in entry && entry.id) return `${entry.provider}/${entry.id}`;
	return entry.provider;
}

function sortedPriorityIndices(providers: SearchProviderEntry[]): number[] {
	return providers
		.map((provider, index) => ({ index, priority: provider.priority ?? index }))
		.sort((left, right) => left.priority - right.priority || left.index - right.index)
		.map((item) => item.index);
}

function weightedIndices(providers: SearchProviderEntry[]): number[] {
	const indices: number[] = [];
	for (const [index, provider] of providers.entries()) {
		const weight = Math.max(1, Math.trunc(provider.weight ?? 1));
		for (let count = 0; count < weight; count += 1) indices.push(index);
	}
	return indices.length > 0 ? indices : providers.map((_provider, index) => index);
}

function rotateUnique(indices: number[], start: number, providerCount: number): number[] {
	const order: number[] = [];
	for (let offset = 0; offset < indices.length; offset += 1) {
		const index = indices[(start + offset) % indices.length];
		if (index !== undefined && !order.includes(index)) order.push(index);
	}
	for (let index = 0; index < providerCount; index += 1) {
		if (!order.includes(index)) order.push(index);
	}
	return order;
}

function selectOrder(strategy: RoutingStrategy, providers: SearchProviderEntry[], state: SearchRoutingState): number[] {
	if (strategy === "priority") return sortedPriorityIndices(providers);
	if (strategy === "round-robin") {
		const indices = weightedIndices(providers);
		const order = rotateUnique(indices, state.roundRobinCursor % indices.length, providers.length);
		state.roundRobinCursor = (state.roundRobinCursor + 1) % indices.length;
		return order;
	}

	let selected = 0;
	let selectedCount = state.successCounts[0] ?? 0;
	for (let index = 1; index < providers.length; index += 1) {
		const count = state.successCounts[index] ?? 0;
		if (count < selectedCount) {
			selected = index;
			selectedCount = count;
		}
	}
	return [selected, ...providers.map((_provider, index) => index).filter((index) => index !== selected)];
}

async function performProviderSearch(
	config: SearchProviderEntry,
	request: SearchRequest,
	signal?: AbortSignal,
): Promise<SearchDetails> {
	const startedAt = Date.now();
	const built = buildSearchRequest(config, request);
	let response: Response;
	try {
		const init: RequestInit = {
			...built.init,
		};
		if (built.body !== undefined) init.body = JSON.stringify(built.body);
		if (signal !== undefined) init.signal = signal;
		response = await fetch(built.url, init);
	} catch (error) {
		const details: SearchDetails = {
			provider: config.provider,
			query: request.query,
			results: [],
			durationMs: Date.now() - startedAt,
			truncated: false,
			error: error instanceof Error ? error.message : "Search request failed",
		};
		if (config.id !== undefined) details.entryId = config.id;
		return details;
	}

	let bodyText = "";
	try {
		bodyText = await response.text();
	} catch {
		bodyText = "";
	}
	let payload: unknown = {};
	if (config.provider === "duckduckgo-html") {
		payload = { html: bodyText };
	} else if (bodyText.length > 0) {
		try {
			payload = JSON.parse(bodyText);
		} catch {
			payload = {};
		}
	}
	if (!response.ok) {
		const details: SearchDetails = {
			provider: config.provider,
			query: request.query,
			results: [],
			durationMs: Date.now() - startedAt,
			truncated: false,
			error: httpErrorMessage(response.status, payload, bodyText),
		};
		if (config.id !== undefined) details.entryId = config.id;
		return details;
	}

	const results = normalizeSearchResponse(config.provider, payload);
	const max = request.maxResults;
	const details: SearchDetails = {
		provider: config.provider,
		query: request.query,
		results: results.slice(0, max),
		durationMs: Date.now() - startedAt,
		truncated: results.length > max,
	};
	if (config.id !== undefined) details.entryId = config.id;
	return details;
}

function attemptFromDetails(details: SearchDetails): SearchAttempt {
	const attempt: SearchAttempt = {
		provider: details.provider,
		durationMs: details.durationMs,
		resultsCount: details.results.length,
	};
	if (details.entryId) attempt.entryId = details.entryId;
	if (details.error) attempt.error = details.error;
	return attempt;
}

export async function performSearch(
	config: WebsearchConfig,
	request: SearchRequest,
	signal?: AbortSignal,
	routingState?: SearchRoutingState,
): Promise<SearchDetails> {
	const startedAt = Date.now();
	const state = routingState ?? createSearchRoutingState(config.providers.length);
	const order = selectOrder(config.strategy, config.providers, state);
	const attempts: SearchAttempt[] = [];
	const collected = new Map<string, SearchDetails["results"][number]>();
	let selectedDetails: SearchDetails | undefined;

	for (const index of order) {
		const provider = config.providers[index];
		if (!provider) continue;
		const details = await performProviderSearch(provider, request, signal);
		attempts.push(attemptFromDetails(details));

		if (details.error) {
			if (!config.fallback) return { ...details, strategy: config.strategy, attempts };
			selectedDetails = details;
			continue;
		}

		state.successCounts[index] = (state.successCounts[index] ?? 0) + 1;

		if (config.strategy !== "fill-first") {
			return { ...details, strategy: config.strategy, attempts };
		}

		selectedDetails = details;
		for (const item of details.results) {
			if (collected.size >= request.maxResults) break;
			collected.set(item.url, item);
		}
		if (collected.size >= request.maxResults) break;
	}

	if (collected.size > 0 && selectedDetails) {
		const results = [...collected.values()];
		const details: SearchDetails = {
			provider: selectedDetails.provider,
			query: request.query,
			results,
			durationMs: Date.now() - startedAt,
			truncated: results.length >= request.maxResults,
			strategy: config.strategy,
			attempts,
		};
		if (selectedDetails.entryId !== undefined) details.entryId = selectedDetails.entryId;
		return details;
	}

	const failed = selectedDetails ?? {
		provider: config.providers[0]?.provider ?? "exa",
		query: request.query,
		results: [],
		durationMs: Date.now() - startedAt,
		truncated: false,
		error: "All configured search providers failed.",
	};
	return {
		...failed,
		durationMs: Date.now() - startedAt,
		strategy: config.strategy,
		attempts,
		error: `All configured search providers failed: ${attempts.map((attempt) => `${entryLabel(attempt)} ${attempt.error ?? "failed"}`).join("; ")}`,
	};
}
