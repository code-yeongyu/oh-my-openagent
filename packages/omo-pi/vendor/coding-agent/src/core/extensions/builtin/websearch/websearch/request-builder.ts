import { providerUrl } from "./provider-endpoints.ts";
import type { BuiltSearchRequest, JsonObject, SearchProviderConfig, SearchRequest } from "./types.ts";

const EMPTY_DOMAIN_SENTINEL = "invalid.invalid";

function contentHeaders(extra?: Record<string, string>): Record<string, string> {
	return { Accept: "application/json", "Content-Type": "application/json", ...(extra ?? {}) };
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.trunc(value)));
}

function appendDomainFilters(query: string, allowedDomains?: string[], blockedDomains?: string[]): string {
	const parts = [query];
	for (const domain of allowedDomains ?? []) parts.push(`site:${domain}`);
	for (const domain of blockedDomains ?? []) parts.push(`-site:${domain}`);
	return parts.join(" ");
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function nonEmptyDomains(values: string[]): string[] {
	return values.length > 0 ? values : [EMPTY_DOMAIN_SENTINEL];
}

function resolveDomainFilters(
	config: SearchProviderConfig,
	request: SearchRequest,
): { allowedDomains?: string[]; blockedDomains?: string[] } {
	const configAllowed = config.allowedDomains;
	const configBlocked = config.blockedDomains;
	const requestAllowed = request.allowedDomains;
	const requestBlocked = request.blockedDomains;

	if (configAllowed) {
		const narrowed = requestAllowed
			? configAllowed.filter((domain) => requestAllowed.includes(domain))
			: configAllowed;
		const allowed = requestBlocked ? narrowed.filter((domain) => !requestBlocked.includes(domain)) : narrowed;
		return { allowedDomains: nonEmptyDomains(unique(allowed)) };
	}

	if (configBlocked) {
		const blocked = unique([...configBlocked, ...(requestBlocked ?? [])]);
		if (requestAllowed) {
			return { allowedDomains: nonEmptyDomains(requestAllowed.filter((domain) => !blocked.includes(domain))) };
		}
		return { blockedDomains: blocked };
	}

	if (requestAllowed) return { allowedDomains: unique(requestAllowed) };
	if (requestBlocked) return { blockedDomains: unique(requestBlocked) };
	return {};
}

function searchOnlyPrompt(query: string): string {
	return `Find web pages matching any of these search terms or quoted phrases. If the query contains OR, search each alternative independently. Return only relevant source URLs, one per line. Query: ${query}`;
}

export function buildSearchRequest(config: SearchProviderConfig, request: SearchRequest): BuiltSearchRequest {
	const maxResults = config.maxResults ?? request.maxResults;
	const { allowedDomains, blockedDomains } = resolveDomainFilters(config, request);

	if (config.provider === "exa") {
		const headers = contentHeaders({ "x-api-key": config.apiKey ?? "" });
		const body: JsonObject = { query: request.query, numResults: clamp(maxResults, 1, 20) };
		if (allowedDomains) body.includeDomains = allowedDomains;
		if (blockedDomains) body.excludeDomains = blockedDomains;
		return { url: providerUrl(config), init: { method: "POST", headers }, body };
	}

	if (config.provider === "tavily") {
		const body: JsonObject = { query: request.query, max_results: clamp(maxResults, 1, 20) };
		if (allowedDomains) body.include_domains = allowedDomains;
		if (blockedDomains) body.exclude_domains = blockedDomains;
		return {
			url: providerUrl(config),
			init: { method: "POST", headers: contentHeaders({ Authorization: `Bearer ${config.apiKey ?? ""}` }) },
			body,
		};
	}

	if (config.provider === "brave") {
		const url = new URL(providerUrl(config));
		url.searchParams.set("q", appendDomainFilters(request.query, allowedDomains, blockedDomains));
		url.searchParams.set("count", String(clamp(maxResults, 1, 20)));
		return {
			url: url.toString(),
			init: { method: "GET", headers: { Accept: "application/json", "X-Subscription-Token": config.apiKey ?? "" } },
		};
	}

	if (config.provider === "duckduckgo-html") {
		const url = new URL(providerUrl(config));
		url.searchParams.set("q", appendDomainFilters(request.query, allowedDomains, blockedDomains));
		return { url: url.toString(), init: { method: "GET", headers: { Accept: "text/html" } } };
	}

	if (config.provider === "serper") {
		const body: JsonObject = {
			q: appendDomainFilters(request.query, allowedDomains, blockedDomains),
			num: clamp(maxResults, 1, 20),
		};
		return {
			url: providerUrl(config),
			init: { method: "POST", headers: contentHeaders({ "X-API-KEY": config.apiKey ?? "" }) },
			body,
		};
	}

	if (config.provider === "google-cse") {
		const url = new URL(providerUrl(config));
		url.searchParams.set("q", appendDomainFilters(request.query, allowedDomains, blockedDomains));
		url.searchParams.set("key", config.apiKey ?? "");
		url.searchParams.set("cx", config.searchEngineId ?? "");
		url.searchParams.set("num", String(clamp(maxResults, 1, 10)));
		return { url: url.toString(), init: { method: "GET", headers: { Accept: "application/json" } } };
	}

	if (config.provider === "z-ai") {
		if (config.model) {
			const webSearch: JsonObject = {
				enable: true,
				search_engine: "search-prime",
				search_result: true,
				count: clamp(maxResults, 1, 50),
			};
			if (allowedDomains?.[0]) webSearch.search_domain_filter = allowedDomains[0];
			if (config.searchContextSize) webSearch.content_size = config.searchContextSize;
			return {
				url: providerUrl(config),
				init: { method: "POST", headers: contentHeaders({ Authorization: `Bearer ${config.apiKey ?? ""}` }) },
				body: {
					model: config.model,
					messages: [{ role: "user", content: request.query }],
					tools: [{ type: "web_search", web_search: webSearch }],
				},
			};
		}

		const body: JsonObject = {
			search_engine: "search-prime",
			search_query: appendDomainFilters(request.query, undefined, blockedDomains),
			count: clamp(maxResults, 1, 50),
		};
		if (allowedDomains?.[0]) body.search_domain_filter = allowedDomains[0];
		return {
			url: providerUrl(config),
			init: { method: "POST", headers: contentHeaders({ Authorization: `Bearer ${config.apiKey ?? ""}` }) },
			body,
		};
	}

	if (config.provider === "perplexity") {
		if (config.model) {
			const body: JsonObject = {
				model: config.model,
				messages: [{ role: "user", content: request.query }],
			};
			if (allowedDomains) body.search_domain_filter = allowedDomains;
			if (!allowedDomains && blockedDomains)
				body.search_domain_filter = blockedDomains.map((domain) => `-${domain}`);
			if (config.searchContextSize) body.web_search_options = { search_context_size: config.searchContextSize };
			return {
				url: providerUrl(config),
				init: { method: "POST", headers: contentHeaders({ Authorization: `Bearer ${config.apiKey ?? ""}` }) },
				body,
			};
		}

		const body: JsonObject = { query: request.query, max_results: clamp(maxResults, 1, 20) };
		if (allowedDomains) body.search_domain_filter = allowedDomains;
		if (!allowedDomains && blockedDomains) body.search_domain_filter = blockedDomains.map((domain) => `-${domain}`);
		return {
			url: providerUrl(config),
			init: { method: "POST", headers: contentHeaders({ Authorization: `Bearer ${config.apiKey ?? ""}` }) },
			body,
		};
	}

	if (config.provider === "xai") {
		const webSearchTool: JsonObject = { type: "web_search" };
		if (allowedDomains) webSearchTool.filters = { allowed_domains: allowedDomains.slice(0, 5) };
		if (!allowedDomains && blockedDomains) webSearchTool.filters = { excluded_domains: blockedDomains.slice(0, 5) };
		return {
			url: providerUrl(config),
			init: { method: "POST", headers: contentHeaders({ Authorization: `Bearer ${config.apiKey ?? ""}` }) },
			body: {
				model: config.model ?? "grok-4.3",
				input: request.query,
				tools: [webSearchTool],
				tool_choice: "required",
			},
		};
	}

	if (config.provider === "anthropic") {
		const webSearchTool: JsonObject = { type: "web_search_20250305", name: "web_search", max_uses: 8 };
		if (allowedDomains) webSearchTool.allowed_domains = allowedDomains;
		if (blockedDomains) webSearchTool.blocked_domains = blockedDomains;
		return {
			url: providerUrl(config),
			init: {
				method: "POST",
				headers: contentHeaders({
					"x-api-key": config.apiKey ?? "",
					"anthropic-version": "2023-06-01",
				}),
			},
			body: {
				model: config.model ?? "claude-sonnet-4-5-20250929",
				max_tokens: 1024,
				messages: [{ role: "user", content: request.query }],
				tools: [webSearchTool],
			},
		};
	}

	if (config.provider === "kimi") {
		return {
			url: providerUrl(config),
			init: { method: "POST", headers: contentHeaders({ Authorization: `Bearer ${config.apiKey ?? ""}` }) },
			body: {
				text_query: appendDomainFilters(request.query, allowedDomains, blockedDomains),
				limit: clamp(maxResults, 1, 20),
				enable_page_crawling: false,
				timeout_seconds: 30,
			},
		};
	}

	const webSearchTool: JsonObject = {
		type: "web_search",
		external_web_access: (config.codexMode ?? "live") === "live",
	};
	if (config.searchContextSize) webSearchTool.search_context_size = config.searchContextSize;
	if (allowedDomains) webSearchTool.filters = { allowed_domains: allowedDomains };
	if (config.userLocation) webSearchTool.user_location = { type: "approximate", ...config.userLocation };
	const input = searchOnlyPrompt(
		blockedDomains ? appendDomainFilters(request.query, undefined, blockedDomains) : request.query,
	);

	return {
		url: providerUrl(config),
		init: { method: "POST", headers: contentHeaders({ Authorization: `Bearer ${config.apiKey ?? ""}` }) },
		body: {
			model: config.model ?? "gpt-5.5",
			input,
			tools: [webSearchTool],
			include: ["web_search_call.action.sources"],
			tool_choice: "required",
		},
	};
}
