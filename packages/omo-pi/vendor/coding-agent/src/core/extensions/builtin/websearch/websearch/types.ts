export type SearchProvider =
	| "exa"
	| "tavily"
	| "brave"
	| "duckduckgo-html"
	| "serper"
	| "google-cse"
	| "z-ai"
	| "openai"
	| "codex"
	| "anthropic"
	| "perplexity"
	| "xai"
	| "kimi";

export type SearchContextSize = "low" | "medium" | "high";
export type CodexSearchMode = "cached" | "live";
export type RoutingStrategy = "priority" | "round-robin" | "fill-first";

export interface SearchProviderConfig {
	id?: string;
	provider: SearchProvider;
	apiKey?: string;
	baseUrl?: string;
	searchEngineId?: string;
	maxResults?: number;
	model?: string;
	codexMode?: CodexSearchMode;
	searchContextSize?: SearchContextSize;
	allowedDomains?: string[];
	blockedDomains?: string[];
	userLocation?: SearchUserLocation;
}

export interface SearchProviderEntry extends SearchProviderConfig {
	priority?: number;
	weight?: number;
}

export interface WebsearchConfig {
	strategy: RoutingStrategy;
	fallback: boolean;
	auto: boolean;
	providers: SearchProviderEntry[];
}

export interface SearchUserLocation {
	country?: string;
	region?: string;
	city?: string;
	timezone?: string;
}

export interface SearchRequest {
	query: string;
	maxResults: number;
	allowedDomains?: string[];
	blockedDomains?: string[];
}

export interface BuiltSearchRequest {
	url: string;
	init: {
		method: "GET" | "POST";
		headers: Record<string, string>;
	};
	body?: JsonObject;
}

export interface SearchResultItem {
	title: string;
	url: string;
	snippet?: string;
	score?: number;
	source?: string;
	publishedAt?: string;
}

export interface SearchDetails {
	provider: SearchProvider;
	entryId?: string;
	query: string;
	results: SearchResultItem[];
	durationMs: number;
	truncated: boolean;
	strategy?: RoutingStrategy;
	attempts?: SearchAttempt[];
	answer?: string;
	error?: string;
}

export interface SearchProgressDetails {
	phase: "searching";
	query: string;
	providerLabels: string[];
	maxResults: number;
	strategy?: RoutingStrategy;
	allowedDomains?: string[];
	blockedDomains?: string[];
}

export type ConfigLoadFailureReason =
	| "missing_config"
	| "invalid_config"
	| "missing_api_key"
	| "provider_native_bypass";

export interface SearchErrorDetails {
	phase: "error";
	query: string;
	error: string;
	reason?: ConfigLoadFailureReason;
}

export type SearchRenderDetails = SearchDetails | SearchProgressDetails | SearchErrorDetails;

export interface SearchAttempt {
	provider: SearchProvider;
	entryId?: string;
	durationMs: number;
	resultsCount: number;
	error?: string;
}

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface JsonObject {
	[key: string]: JsonValue;
}

export type ConfigLoadResult =
	| { ok: true; config: WebsearchConfig; source: string }
	| {
			ok: false;
			reason: ConfigLoadFailureReason;
			message: string;
			source?: string;
	  };

export type ProviderValidationResult =
	| { ok: true; config: SearchProviderEntry }
	| { ok: false; reason: "invalid_config" | "missing_api_key"; message: string };
