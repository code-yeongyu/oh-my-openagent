import type { SearchResultItem } from "./types.ts";

function result(title: string | undefined, url: string | undefined, snippet?: string): SearchResultItem | null {
	if (!title || !url) return null;
	const item: SearchResultItem = { title, url };
	if (snippet) item.snippet = snippet;
	return item;
}

function collect(items: Array<SearchResultItem | null>, max = 50): SearchResultItem[] {
	return items.filter((item): item is SearchResultItem => item !== null).slice(0, max);
}

function htmlDecode(value: string): string {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

function stripHtml(value: string): string {
	return htmlDecode(
		value
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

function duckDuckGoResultUrl(rawHref: string): string | undefined {
	const decodedHref = htmlDecode(rawHref);
	const absoluteHref = decodedHref.startsWith("//") ? `https:${decodedHref}` : decodedHref;
	let url: URL;
	try {
		url = new URL(absoluteHref);
	} catch {
		return undefined;
	}
	const redirected = url.searchParams.get("uddg");
	return redirected ?? absoluteHref;
}

export function normalizeDuckDuckGoHtml(html: string): SearchResultItem[] {
	const matches = [...html.matchAll(/<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
	const snippets = [...html.matchAll(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map(
		(match) => stripHtml(match[1] ?? ""),
	);
	return collect(
		matches.map((match, index) => {
			const title = stripHtml(match[2] ?? "");
			const url = duckDuckGoResultUrl(match[1] ?? "");
			return result(title, url, snippets[index]);
		}),
	);
}
