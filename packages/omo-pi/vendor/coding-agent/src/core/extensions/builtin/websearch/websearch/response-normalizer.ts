import { normalizeDuckDuckGoHtml } from "./duckduckgo-html.ts";
import type { JsonObject, JsonValue, SearchProvider, SearchResultItem } from "./types.ts";

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getObject(value: JsonValue | undefined): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function getArray(value: JsonValue | undefined): JsonValue[] {
	return Array.isArray(value) ? value : [];
}

function getString(value: JsonValue | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function getNumber(value: JsonValue | undefined): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function result(
	title: string | undefined,
	url: string | undefined,
	snippet?: string,
	source?: string,
	score?: number,
): SearchResultItem | null {
	if (!title || !url) return null;
	const item: SearchResultItem = { title, url };
	if (snippet) item.snippet = snippet;
	if (source) item.source = source;
	if (score !== undefined) item.score = score;
	return item;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function resultsFromTextUrls(text: string | undefined): SearchResultItem[] {
	if (!text) return [];
	const urls = text.match(/https?:\/\/[^\s)\]}>"]+/g) ?? [];
	return collect(
		unique(urls).map((url) => {
			const cleaned = url.replace(/[.,;:]+$/, "");
			return result(cleaned, cleaned, text);
		}),
	);
}

function collect(items: Array<SearchResultItem | null>, max = 50): SearchResultItem[] {
	return items.filter((item): item is SearchResultItem => item !== null).slice(0, max);
}

function parseObjectPayload(payload: unknown): JsonObject {
	if (isJsonObject(payload)) return payload;
	return {};
}

export function normalizeSearchResponse(provider: SearchProvider, payload: unknown): SearchResultItem[] {
	const data = parseObjectPayload(payload);

	if (provider === "exa") {
		return collect(
			getArray(data.results).map((raw) => {
				const item = getObject(raw);
				return result(
					getString(item?.title),
					getString(item?.url),
					getString(item?.text) ?? getString(item?.snippet),
					undefined,
					getNumber(item?.score),
				);
			}),
		);
	}

	if (provider === "tavily") {
		return collect(
			getArray(data.results).map((raw) => {
				const item = getObject(raw);
				return result(
					getString(item?.title),
					getString(item?.url),
					getString(item?.content),
					undefined,
					getNumber(item?.score),
				);
			}),
		);
	}

	if (provider === "brave") {
		const web = getObject(data.web);
		return collect(
			getArray(web?.results).map((raw) => {
				const item = getObject(raw);
				return result(getString(item?.title), getString(item?.url), getString(item?.description));
			}),
		);
	}

	if (provider === "duckduckgo-html") return normalizeDuckDuckGoHtml(getString(data.html) ?? "");

	if (provider === "serper") {
		return collect(
			getArray(data.organic).map((raw) => {
				const item = getObject(raw);
				return result(getString(item?.title), getString(item?.link), getString(item?.snippet));
			}),
		);
	}

	if (provider === "google-cse") {
		return collect(
			getArray(data.items).map((raw) => {
				const item = getObject(raw);
				return result(getString(item?.title), getString(item?.link), getString(item?.snippet));
			}),
		);
	}

	if (provider === "z-ai") {
		const chatResults = collect(
			getArray(data.web_search).map((raw) => {
				const item = getObject(raw);
				return result(
					getString(item?.title),
					getString(item?.link),
					getString(item?.content),
					getString(item?.media),
				);
			}),
		);
		if (chatResults.length > 0) return chatResults;

		return collect(
			getArray(data.search_result).map((raw) => {
				const item = getObject(raw);
				return result(
					getString(item?.title),
					getString(item?.link),
					getString(item?.content),
					getString(item?.media),
				);
			}),
		);
	}

	if (provider === "perplexity") {
		const chatResults = collect(
			getArray(data.search_results).map((raw) => {
				const item = getObject(raw);
				const searchResult = result(getString(item?.title), getString(item?.url), getString(item?.snippet));
				if (searchResult) {
					const publishedAt = getString(item?.date) ?? getString(item?.last_updated);
					if (publishedAt) searchResult.publishedAt = publishedAt;
				}
				return searchResult;
			}),
		);
		if (chatResults.length > 0) return chatResults;

		return collect(
			getArray(data.results).map((raw) => {
				const item = getObject(raw);
				const searchResult = result(getString(item?.title), getString(item?.url), getString(item?.snippet));
				if (searchResult) {
					const publishedAt = getString(item?.date) ?? getString(item?.last_updated);
					if (publishedAt) searchResult.publishedAt = publishedAt;
				}
				return searchResult;
			}),
		);
	}

	if (provider === "anthropic") {
		const content = getArray(data.content);
		const text = content
			.map(getObject)
			.map((item) => getString(item?.text))
			.filter((value): value is string => value !== undefined)
			.join("\n");
		return collect(
			content.flatMap((raw) => {
				const item = getObject(raw);
				if (item?.type !== "web_search_tool_result") return [];
				return getArray(item.content).map((searchRaw) => {
					const searchItem = getObject(searchRaw);
					return result(
						getString(searchItem?.title),
						getString(searchItem?.url),
						getString(searchItem?.page_age) ?? text,
					);
				});
			}),
		);
	}

	if (provider === "kimi") {
		return collect(
			getArray(data.search_results).map((raw) => {
				const item = getObject(raw);
				return result(
					getString(item?.title),
					getString(item?.url),
					getString(item?.summary) ?? getString(item?.content),
				);
			}),
		);
	}

	const output = getArray(data.output);
	const sources = collect(
		output.flatMap((raw) => {
			const item = getObject(raw);
			if (item?.type !== "web_search_call") return [];
			const action = getObject(item.action);
			return getArray(action?.sources).map((sourceRaw) => {
				const source = getObject(sourceRaw);
				const url = getString(source?.url);
				return result(url, url);
			});
		}),
	);
	const message = output.map(getObject).find((item) => item?.type === "message");
	const content = getArray(message?.content)
		.map(getObject)
		.find((item) => item?.type === "output_text");
	const text = getString(content?.text);
	const annotationResults = collect(
		getArray(content?.annotations).map((raw) => {
			const item = getObject(raw);
			return item?.type === "url_citation" ? result(getString(item.title), getString(item.url), text) : null;
		}),
	);
	if (annotationResults.length > 0) return annotationResults;
	if (sources.length > 0) {
		return sources.map((source) => {
			if (source.snippet || text === undefined) return source;
			return { ...source, snippet: text };
		});
	}
	const textUrls = resultsFromTextUrls(text);
	if (textUrls.length > 0) return textUrls;
	if (provider !== "xai") return annotationResults;
	return collect(
		getArray(data.citations).map((raw) => {
			const url = getString(raw);
			return result(url, url, text);
		}),
	);
}
