import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { isAllowedProviderBaseUrl } from "./provider-endpoints.ts";
import type {
	CodexSearchMode,
	ConfigLoadResult,
	JsonObject,
	JsonValue,
	ProviderValidationResult,
	RoutingStrategy,
	SearchContextSize,
	SearchProvider,
	SearchProviderConfig,
	SearchProviderEntry,
	SearchUserLocation,
	WebsearchConfig,
} from "./types.ts";

const PROVIDERS: readonly SearchProvider[] = [
	"exa",
	"tavily",
	"brave",
	"duckduckgo-html",
	"serper",
	"google-cse",
	"z-ai",
	"openai",
	"codex",
	"anthropic",
	"perplexity",
	"xai",
	"kimi",
];
const CONTEXT_SIZES: readonly SearchContextSize[] = ["low", "medium", "high"];
const CODEX_MODES: readonly CodexSearchMode[] = ["cached", "live"];
const STRATEGIES: readonly RoutingStrategy[] = ["priority", "round-robin", "fill-first"];
const DEFAULT_FREE_CONFIG: WebsearchConfig = {
	strategy: "priority",
	fallback: true,
	auto: true,
	providers: [{ id: "default", provider: "duckduckgo-html", maxResults: 10 }],
};

export interface ConfigLoadOptions {
	cwd: string;
	homeDir?: string;
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<TValue extends string>(values: readonly TValue[], value: unknown): value is TValue {
	return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isStringArray(value: JsonValue | undefined): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalString(value: JsonValue | undefined): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: JsonValue | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: JsonValue | undefined): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function optionalProvider(value: JsonValue | undefined): SearchProvider | undefined {
	return oneOf(PROVIDERS, value) ? value : undefined;
}

function optionalContextSize(value: JsonValue | undefined): SearchContextSize | undefined {
	return oneOf(CONTEXT_SIZES, value) ? value : undefined;
}

function optionalCodexMode(value: JsonValue | undefined): CodexSearchMode | undefined {
	return oneOf(CODEX_MODES, value) ? value : undefined;
}

function optionalStrategy(value: JsonValue | undefined): RoutingStrategy | undefined {
	return oneOf(STRATEGIES, value) ? value : undefined;
}

function optionalLocation(value: JsonValue | undefined): SearchUserLocation | undefined {
	if (!isJsonObject(value)) return undefined;
	const location: SearchUserLocation = {};
	const country = optionalString(value.country);
	const region = optionalString(value.region);
	const city = optionalString(value.city);
	const timezone = optionalString(value.timezone);
	if (country) location.country = country;
	if (region) location.region = region;
	if (city) location.city = city;
	if (timezone) location.timezone = timezone;
	return Object.keys(location).length > 0 ? location : undefined;
}

function parseJsonObject(content: string): JsonObject | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}
	return isJsonObject(parsed) ? parsed : null;
}

function providerEntryFromObject(raw: JsonObject): SearchProviderEntry | null {
	const provider = optionalProvider(raw.provider) ?? optionalProvider(raw.backend);
	if (!provider) return null;

	const config: SearchProviderEntry = { provider };
	const id = optionalString(raw.id);
	const apiKey = optionalString(raw.apiKey);
	const baseUrl = optionalString(raw.baseUrl);
	const searchEngineId = optionalString(raw.searchEngineId);
	const maxResults = optionalNumber(raw.maxResults);
	const model = optionalString(raw.model);
	const codexMode = optionalCodexMode(raw.codexMode);
	const searchContextSize = optionalContextSize(raw.searchContextSize);
	const rawAllowedDomains = raw.allowedDomains;
	const rawBlockedDomains = raw.blockedDomains;
	const allowedDomains = isStringArray(rawAllowedDomains) ? rawAllowedDomains : undefined;
	const blockedDomains = isStringArray(rawBlockedDomains) ? rawBlockedDomains : undefined;
	const userLocation = optionalLocation(raw.userLocation);
	const priority = optionalNumber(raw.priority);
	const weight = optionalNumber(raw.weight);

	if (id) config.id = id;
	if (apiKey) config.apiKey = apiKey;
	if (baseUrl) config.baseUrl = baseUrl;
	if (searchEngineId) config.searchEngineId = searchEngineId;
	if (maxResults) config.maxResults = maxResults;
	if (model) config.model = model;
	if (codexMode) config.codexMode = codexMode;
	if (searchContextSize) config.searchContextSize = searchContextSize;
	if (allowedDomains) config.allowedDomains = allowedDomains;
	if (blockedDomains) config.blockedDomains = blockedDomains;
	if (userLocation) config.userLocation = userLocation;
	if (priority !== undefined) config.priority = priority;
	if (weight !== undefined) config.weight = weight;

	return config;
}

function configFromObject(raw: JsonObject): WebsearchConfig | null {
	const auto = optionalBoolean(raw.auto) ?? true;
	const providersValue = raw.providers;
	const rawProviders = Array.isArray(providersValue) ? providersValue : undefined;
	if (rawProviders) {
		if (optionalProvider(raw.provider)) return null;
		const providers = rawProviders
			.map((value) => (isJsonObject(value) ? providerEntryFromObject(value) : null))
			.filter((entry): entry is SearchProviderEntry => entry !== null);
		const strategy = optionalStrategy(raw.strategy) ?? "priority";
		const fallback = optionalBoolean(raw.fallback) ?? true;
		return { strategy, fallback, auto, providers };
	}

	const provider = providerEntryFromObject(raw);
	return provider ? { strategy: "priority", fallback: true, auto, providers: [provider] } : null;
}

function hasApiKey(config: SearchProviderConfig): boolean {
	return typeof config.apiKey === "string" && config.apiKey.length > 0;
}

export function validateProviderConfig(config: SearchProviderEntry): ProviderValidationResult {
	if (!PROVIDERS.includes(config.provider)) {
		return { ok: false, reason: "invalid_config", message: `Unsupported provider: ${config.provider}` };
	}

	if (config.allowedDomains && config.blockedDomains) {
		return {
			ok: false,
			reason: "invalid_config",
			message: "Provider config cannot specify both allowedDomains and blockedDomains.",
		};
	}

	if (config.weight !== undefined && config.weight <= 0) {
		return { ok: false, reason: "invalid_config", message: "Provider weight must be greater than 0." };
	}

	if (config.baseUrl && !isAllowedProviderBaseUrl(config.baseUrl)) {
		return {
			ok: false,
			reason: "invalid_config",
			message: `Provider ${config.provider} baseUrl must be a public HTTPS URL without credentials.`,
		};
	}

	if (config.provider === "google-cse" && !config.searchEngineId) {
		return { ok: false, reason: "missing_api_key", message: "Provider google-cse requires searchEngineId." };
	}

	if ((config.provider === "codex" || config.provider === "openai") && !hasApiKey(config)) {
		return {
			ok: false,
			reason: "missing_api_key",
			message: `Provider ${config.provider} requires apiKey for hosted Responses API search.`,
		};
	}

	if (
		config.provider !== "codex" &&
		config.provider !== "openai" &&
		config.provider !== "duckduckgo-html" &&
		!hasApiKey(config)
	) {
		return { ok: false, reason: "missing_api_key", message: `Provider ${config.provider} requires apiKey.` };
	}

	return { ok: true, config };
}

export function validateWebsearchConfig(
	config: WebsearchConfig,
): ProviderValidationResult | { ok: true; config: WebsearchConfig } {
	if (!STRATEGIES.includes(config.strategy)) {
		return { ok: false, reason: "invalid_config", message: `Unsupported routing strategy: ${config.strategy}` };
	}
	if (typeof config.auto !== "boolean") {
		return { ok: false, reason: "invalid_config", message: "Websearch config auto must be a boolean." };
	}
	if (config.providers.length === 0) {
		return { ok: false, reason: "invalid_config", message: "Websearch config requires at least one provider." };
	}

	for (const provider of config.providers) {
		const validation = validateProviderConfig(provider);
		if (!validation.ok) return validation;
	}

	return { ok: true, config };
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function loadWebsearchConfig(options: ConfigLoadOptions): Promise<ConfigLoadResult> {
	const home = options.homeDir ?? homedir();
	const paths = [
		join(options.cwd, ".pi", "websearch.json"),
		join(home, "websearch.json"),
		join(home, ".pi", "websearch.json"),
	];

	for (const path of paths) {
		if (!(await fileExists(path))) continue;
		const raw = parseJsonObject(await readFile(path, "utf8"));
		if (!raw) {
			return { ok: false, reason: "invalid_config", message: `Invalid JSON object in ${path}`, source: path };
		}
		const config = configFromObject(raw);
		if (!config) {
			return { ok: false, reason: "invalid_config", message: `Invalid provider config in ${path}`, source: path };
		}
		const validation = validateWebsearchConfig(config);
		if (!validation.ok) return { ...validation, source: path };
		return { ok: true, config, source: path };
	}

	return { ok: true, config: DEFAULT_FREE_CONFIG, source: "default:duckduckgo-html" };
}
