import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";

interface ReadableArticle {
	readonly title: string;
	readonly content: string;
	readonly hasHeading: boolean;
}

const TAGS_TO_REMOVE = /<(script|style|noscript|iframe|object|embed|meta|link)\b[^>]*>[\s\S]*?<\/\1>/gi;
const VOID_TAGS_TO_REMOVE = /<(script|style|noscript|iframe|object|embed|meta|link)\b[^>]*\/?>/gi;
const BLOCK_BREAK_TAGS =
	/<\/?(address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const BLOCK_BREAK_SELECTOR =
	"address, article, aside, blockquote, dd, div, dl, dt, figcaption, figure, footer, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, tbody, tfoot, thead, tr, ul";
const CELL_BREAK_SELECTOR = "td, th";
const TAGS = /<[^>]+>/g;
const WHITESPACE = /[\t\f\v \u00a0]+/g;
const NEWLINE_RUN = /\n{3,}/g;
const MIN_EXPLICIT_ARTICLE_TEXT_LENGTH = 30;
const EXPLICIT_ARTICLE_SELECTORS = [
	".article_view",
	".tt_article_useless_p_margin",
	".entry-content",
	".contents_style",
	".post-content",
	".article-content",
	".content-article",
	"#content .contents_style",
];
const TITLE_SELECTORS = [".tit_post", ".entry-title", ".post-title", ".article-title", "h1"];
const ARTICLE_NOISE_SELECTOR = [
	"script",
	"style",
	"noscript",
	"iframe",
	"object",
	"embed",
	"meta",
	"link",
	"nav",
	"aside",
	"footer",
	".another_category",
	".area_related",
	".related",
	".revenue_unit_wrap",
	".adsbygoogle",
	".container_postbtn",
	".postbtn_like",
	".comments",
	".comment",
	".tagTrail",
	".sidebar",
].join(", ");
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

export function htmlToMarkdown(html: string, url: string): string {
	const article = extractReadableArticle(html, url);
	if (!article) return normalizeMarkdown(turndownService.turndown(html));

	const markdown = normalizeMarkdown(turndownService.turndown(article.content));
	if (!article.title || article.hasHeading || markdown.startsWith(`# ${article.title}`)) return markdown;
	return `# ${article.title}\n\n${markdown}`.trim();
}

export function htmlToText(html: string, url: string): string {
	const article = extractReadableArticle(html, url);
	if (article) {
		const body = htmlFragmentToPlainText(article.content);
		if (!article.title || article.hasHeading) return body;
		if (body.startsWith(article.title)) return body;
		return `${article.title}\n\n${body}`.trim();
	}

	return htmlFragmentToPlainText(html);
}

function htmlFragmentToPlainText(html: string): string {
	try {
		const dom = new JSDOM(`<body>${html}</body>`, {
			contentType: "text/html",
			virtualConsole: new VirtualConsole(),
		});
		try {
			const document = dom.window.document;
			for (const element of document.querySelectorAll(
				"script, style, noscript, iframe, object, embed, meta, link",
			)) {
				element.remove();
			}
			for (const element of document.querySelectorAll("br")) {
				element.replaceWith(document.createTextNode("\n"));
			}
			for (const element of document.querySelectorAll(CELL_BREAK_SELECTOR)) {
				element.after(document.createTextNode("\n"));
			}
			for (const element of document.querySelectorAll(BLOCK_BREAK_SELECTOR)) {
				element.before(document.createTextNode("\n"));
				element.after(document.createTextNode("\n"));
			}
			return normalizePlainText(document.body.textContent ?? "");
		} finally {
			dom.window.close();
		}
	} catch (error) {
		if (!(error instanceof Error)) throw error;
	}

	return htmlFragmentToPlainTextFallback(html);
}

function htmlFragmentToPlainTextFallback(html: string): string {
	return decodeHtmlEntities(
		normalizePlainText(
			html
				.replace(TAGS_TO_REMOVE, "")
				.replace(VOID_TAGS_TO_REMOVE, "")
				.replace(BLOCK_BREAK_TAGS, "\n")
				.replace(TAGS, ""),
		),
	);
}

function extractReadableArticle(html: string, url: string): ReadableArticle | undefined {
	try {
		const dom = new JSDOM(html, {
			url,
			contentType: "text/html",
			virtualConsole: new VirtualConsole(),
		});
		try {
			let explicitArticle: ReadableArticle | undefined;
			for (const selector of EXPLICIT_ARTICLE_SELECTORS) {
				const candidate = dom.window.document.querySelector(selector);
				if (!candidate) continue;
				const clonedNode = candidate.cloneNode(true);
				if (!(clonedNode instanceof dom.window.Element)) continue;
				for (const noisyElement of clonedNode.querySelectorAll(ARTICLE_NOISE_SELECTOR)) {
					noisyElement.remove();
				}
				const text = normalizePlainText(clonedNode.textContent ?? "");
				if (text.length < MIN_EXPLICIT_ARTICLE_TEXT_LENGTH) continue;
				explicitArticle = {
					title: selectPreferredTitle(dom.window.document, dom.window.document.title),
					content: clonedNode.innerHTML,
					hasHeading: /<h[1-6]\b/i.test(clonedNode.innerHTML),
				};
				break;
			}
			if (explicitArticle) return explicitArticle;

			const article = new Readability(dom.window.document, {
				charThreshold: 80,
				keepClasses: false,
			}).parse();
			if (!article?.content || !article.textContent) return undefined;
			return {
				title: selectPreferredTitle(dom.window.document, article.title ?? ""),
				content: article.content,
				hasHeading: /<h[1-6]\b/i.test(article.content),
			};
		} finally {
			dom.window.close();
		}
	} catch (error) {
		if (error instanceof Error) return undefined;
		throw error;
	}
}

function selectPreferredTitle(document: Document, fallback: string): string {
	for (const selector of TITLE_SELECTORS) {
		const title = normalizePlainText(document.querySelector(selector)?.textContent ?? "");
		if (title) return title;
	}
	return normalizePlainText(fallback);
}

function normalizePlainText(text: string): string {
	return text
		.replace(WHITESPACE, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(NEWLINE_RUN, "\n\n")
		.trim();
}

function normalizeMarkdown(markdown: string): string {
	return markdown
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(NEWLINE_RUN, "\n\n")
		.trim();
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
