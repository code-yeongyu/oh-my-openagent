import type { AssistantMessage, ProviderNativeContent } from "@earendil-works/pi-ai";

type NativeRecord = Record<string, unknown>;

interface SearchSource {
	title?: string;
	url?: string;
	snippet?: string;
	status?: string;
}

function isRecord(value: unknown): value is NativeRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(record: NativeRecord | undefined, key: string): NativeRecord | undefined {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
}

function readArray(record: NativeRecord | undefined, key: string): unknown[] {
	const value = record?.[key];
	return Array.isArray(value) ? value : [];
}

function readString(record: NativeRecord | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function readStringArray(record: NativeRecord | undefined, key: string): string[] {
	return readArray(record, key).filter((value): value is string => typeof value === "string");
}

function formatProviderName(message: AssistantMessage): string {
	return message.provider ? `${message.provider} · ` : "";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function shorten(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function quoted(value: string): string {
	return JSON.stringify(value);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function getWebSearchResults(raw: unknown): NativeRecord[] | undefined {
	if (!isRecord(raw) || !Array.isArray(raw.content)) {
		return undefined;
	}

	return raw.content.filter(isRecord).filter((item) => readString(item, "type") === "web_search_result");
}

function sourceFromRecord(record: NativeRecord | undefined): SearchSource | undefined {
	if (!record) return undefined;
	const title = readString(record, "title") ?? readString(record, "name");
	const url =
		readString(record, "url") ??
		readString(record, "uri") ??
		readString(record, "retrievedUrl") ??
		readString(record, "sourceUrl");
	const snippet =
		readString(record, "snippet") ??
		readString(record, "text") ??
		readString(record, "summary") ??
		readString(record, "page_age");
	const status = readString(record, "status") ?? readString(record, "urlRetrievalStatus");
	if (!title && !url && !snippet && !status) return undefined;
	return { ...(title && { title }), ...(url && { url }), ...(snippet && { snippet }), ...(status && { status }) };
}

function sourceFromGoogleGroundingChunk(record: NativeRecord): SearchSource | undefined {
	return sourceFromRecord(readRecord(record, "web") ?? record);
}

function formatQueries(queries: string[]): string[] {
	const values = unique(queries);
	if (values.length === 0) return [];
	if (values.length === 1) return [`query: ${quoted(values[0])}`];
	return ["queries:", ...values.map((query) => `- ${quoted(query)}`)];
}

function formatSources(sources: SearchSource[], label: "result" | "source" | "url", expanded: boolean): string[] {
	if (sources.length === 0) return [];

	const visibleSources = expanded ? sources : sources.slice(0, 3);
	const lines = [pluralize(sources.length, label)];
	for (const source of visibleSources) {
		const title = source.title ? shorten(source.title, 100) : undefined;
		const url = source.url ? shorten(source.url, 120) : undefined;
		const status = source.status ? ` (${source.status})` : "";
		if (title && url) {
			lines.push(`${title} ${url}${status}`);
		} else if (title) {
			lines.push(`${title}${status}`);
		} else if (url) {
			lines.push(`${url}${status}`);
		} else if (source.status) {
			lines.push(source.status);
		}
		if (source.snippet) {
			lines.push(`  ${shorten(source.snippet, 160)}`);
		}
	}
	if (!expanded && sources.length > visibleSources.length) {
		lines.push(`… ${sources.length - visibleSources.length} more ${label}s`);
	}
	return lines;
}

function formatServerToolUseBody(raw: unknown): string | undefined {
	const record = isRecord(raw) ? raw : undefined;
	const input = readRecord(record, "input");
	const query = readString(input, "query");
	if (query) {
		return `query: ${quoted(query)}`;
	}
	const name = readString(record, "name");
	if (name) {
		return `name: ${name}`;
	}
	return undefined;
}

function formatAnthropicWebSearchResultBody(raw: unknown, expanded: boolean): string | undefined {
	const results = getWebSearchResults(raw);
	if (!results) {
		return undefined;
	}
	if (results.length === 0) {
		return "0 results";
	}

	const sources = results.flatMap((result) => {
		const source = sourceFromRecord(result);
		return source ? [source] : [];
	});
	return formatSources(sources, "result", expanded).join("\n");
}

function formatOpenAiWebSearchCallBody(raw: unknown, expanded: boolean): string | undefined {
	const record = isRecord(raw) ? raw : undefined;
	if (!record) return undefined;

	const action = readRecord(record, "action");
	const status = readString(record, "status");
	const queries = [
		...(readString(action, "query") ? [readString(action, "query") as string] : []),
		...readStringArray(action, "queries"),
	];
	const sources = readArray(action, "sources").flatMap((rawSource) => {
		const source = sourceFromRecord(isRecord(rawSource) ? rawSource : undefined);
		return source ? [source] : [];
	});

	const lines = [
		...(status ? [`status: ${status}`] : []),
		...formatQueries(queries),
		...formatSources(sources, "source", expanded),
	];
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatGoogleGroundingMetadataBody(raw: unknown, expanded: boolean): string | undefined {
	const record = isRecord(raw) ? raw : undefined;
	if (!record) return undefined;

	const queries = readStringArray(record, "webSearchQueries");
	const sources = readArray(record, "groundingChunks").flatMap((rawChunk) => {
		const source = isRecord(rawChunk) ? sourceFromGoogleGroundingChunk(rawChunk) : undefined;
		return source ? [source] : [];
	});

	const lines = [...formatQueries(queries), ...formatSources(sources, "source", expanded)];
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatGoogleUrlContextMetadataBody(raw: unknown, expanded: boolean): string | undefined {
	const record = isRecord(raw) ? raw : undefined;
	if (!record) return undefined;

	const sources = readArray(record, "urlMetadata").flatMap((rawUrl) => {
		const source = sourceFromRecord(isRecord(rawUrl) ? rawUrl : undefined);
		return source ? [source] : [];
	});

	const lines = formatSources(sources, "url", expanded);
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatSpecializedProviderNativeSummary(
	message: AssistantMessage,
	content: ProviderNativeContent,
	expanded: boolean,
): string | undefined {
	const provider = formatProviderName(message);
	const marker = expanded ? "▾" : "▸";
	if (content.subtype === "server_tool_use") {
		const raw = isRecord(content.raw) ? content.raw : undefined;
		const name = readString(raw, "name");
		if (name) {
			return `${marker} ${provider}${name} · server_tool_use`;
		}
	}
	if (content.subtype === "web_search_tool_result") {
		return `${marker} ${provider}web_search results`;
	}
	if (content.subtype === "web_search_call") {
		const raw = isRecord(content.raw) ? content.raw : undefined;
		const status = readString(raw, "status");
		return `${marker} ${provider}web_search${status ? ` · ${status}` : " · web_search_call"}`;
	}
	if (content.subtype === "groundingMetadata") {
		const body = formatGoogleGroundingMetadataBody(content.raw, expanded);
		if (body) {
			return `${marker} ${provider}google_search results`;
		}
	}
	if (content.subtype === "urlContextMetadata") {
		const body = formatGoogleUrlContextMetadataBody(content.raw, expanded);
		if (body) {
			return `${marker} ${provider}url_context results`;
		}
	}
	return undefined;
}

function formatSpecializedProviderNativeBody(content: ProviderNativeContent, expanded: boolean): string | undefined {
	if (content.subtype === "server_tool_use") {
		return formatServerToolUseBody(content.raw);
	}
	if (content.subtype === "web_search_tool_result") {
		return formatAnthropicWebSearchResultBody(content.raw, expanded);
	}
	if (content.subtype === "web_search_call") {
		return formatOpenAiWebSearchCallBody(content.raw, expanded);
	}
	if (content.subtype === "groundingMetadata") {
		return formatGoogleGroundingMetadataBody(content.raw, expanded);
	}
	if (content.subtype === "urlContextMetadata") {
		return formatGoogleUrlContextMetadataBody(content.raw, expanded);
	}
	return undefined;
}

export function stringifyProviderNative(raw: unknown): string {
	try {
		return JSON.stringify(raw, null, 2) ?? "null";
	} catch {
		return String(raw);
	}
}

export function formatProviderNativeSummary(
	message: AssistantMessage,
	content: ProviderNativeContent,
	expanded: boolean,
): string {
	const specialized = formatSpecializedProviderNativeSummary(message, content, expanded);
	if (specialized) {
		return specialized;
	}

	const provider = formatProviderName(message);
	const marker = expanded ? "▾" : "▸";
	return `${marker} ${provider}providerNative · ${content.subtype}`;
}

export function formatProviderNativeBody(content: ProviderNativeContent, expanded: boolean): string {
	const specialized = formatSpecializedProviderNativeBody(content, expanded);
	if (specialized) {
		return specialized;
	}

	const rawJson = stringifyProviderNative(content.raw);
	if (expanded || rawJson.length <= 2000) {
		return rawJson;
	}
	return `${rawJson.slice(0, 2000)}…`;
}
