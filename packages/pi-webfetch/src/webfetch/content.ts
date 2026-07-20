import TurndownService from "turndown";

const TAGS_TO_REMOVE = /<(script|style|noscript|iframe|object|embed|meta|link)\b[^>]*>[\s\S]*?<\/\1>/gi;
const VOID_TAGS_TO_REMOVE = /<(script|style|noscript|iframe|object|embed|meta|link)\b[^>]*\/?>/gi;
const BLOCK_BREAK_TAGS =
	/<\/?(address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const TAGS = /<[^>]+>/g;
const WHITESPACE = /[\t\f\v ]+/g;
const NEWLINE_RUN = /\n{3,}/g;

const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

const turndownService = new TurndownService({
	headingStyle: "atx",
	hr: "---",
	bulletListMarker: "-",
	codeBlockStyle: "fenced",
	emDelimiter: "*",
});
turndownService.remove(["script", "style", "noscript", "iframe", "object", "embed", "meta", "link"]);

export function htmlToMarkdown(html: string): string {
	return turndownService.turndown(html).trim();
}

export function htmlToText(html: string): string {
	return decodeHtmlEntities(
		html
			.replace(TAGS_TO_REMOVE, "")
			.replace(VOID_TAGS_TO_REMOVE, "")
			.replace(BLOCK_BREAK_TAGS, "\n")
			.replace(TAGS, "")
			.replace(WHITESPACE, " ")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n[ \t]+/g, "\n")
			.replace(NEWLINE_RUN, "\n\n")
			.trim(),
	);
}

export function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
		if (entity.startsWith("#x")) {
			return decodeCodePoint(Number.parseInt(entity.slice(2), 16));
		}
		if (entity.startsWith("#")) {
			return decodeCodePoint(Number.parseInt(entity.slice(1), 10));
		}
		return ENTITIES[entity.toLowerCase()] ?? `&${entity};`;
	});
}

function decodeCodePoint(value: number): string {
	if (!Number.isFinite(value)) return "";
	try {
		return String.fromCodePoint(value);
	} catch {
		return "";
	}
}
