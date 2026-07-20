import { StringEnum } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

import { htmlToMarkdown, htmlToText } from "./content.js";
import { clampTimeout, fetchUrl, type WebfetchFormat } from "./fetcher.js";

const WEBFETCH_FORMATS = ["markdown", "text", "html"] as const;

const Params = Type.Object({
	url: Type.String({ description: "The URL to fetch content from" }),
	format: Type.Optional(
		StringEnum(["markdown", "text", "html"] as const, {
			description: "The format to return the content in. Defaults to markdown.",
		}),
	),
	timeout: Type.Optional(Type.Number({ description: "Optional timeout in seconds. Maximum 120." })),
});

export interface WebfetchDetails {
	url: string;
	finalUrl: string;
	format: WebfetchFormat;
	status: number;
	statusText: string;
	contentType: string;
	bytes: number;
	timeoutSeconds: number;
	converted: boolean;
	truncated: boolean;
}

export interface WebfetchProgressDetails {
	phase: "fetching";
	url: string;
	format: WebfetchFormat;
	timeoutSeconds: number;
}

export type WebfetchRenderDetails = WebfetchDetails | WebfetchProgressDetails;

export const webfetch = defineTool<typeof Params, WebfetchRenderDetails>({
	name: "webfetch",
	label: "Web Fetch",
	description:
		"Fetches content from a URL and returns it as markdown, plain text, or HTML. " +
		"Network use is bounded by timeout and response size limits.",
	promptSnippet: "webfetch: retrieve URL content as markdown, text, or html",
	promptGuidelines: [
		"Use webfetch when a specific URL must be retrieved.",
		"Prefer markdown format unless raw HTML or plain text is explicitly needed.",
		"The tool is read-only and does not modify files.",
	],
	parameters: Params,
	async execute(_toolCallId, params, signal, onUpdate, _ctx) {
		const format = parseWebfetchFormat(params.format);
		const timeoutSeconds = clampTimeout(params.timeout);
		onUpdate?.({
			content: [{ type: "text", text: `Fetching ${params.url} as ${format} (timeout ${timeoutSeconds}s)` }],
			details: { phase: "fetching", url: params.url, format, timeoutSeconds },
		});

		const fetched = await fetchUrl({
			url: params.url,
			format,
			timeoutSeconds,
			...(signal === undefined ? {} : { signal }),
		});
		const raw = new TextDecoder().decode(fetched.body);
		const contentType = fetched.contentType.toLowerCase();
		const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
		let text = raw;
		let converted = false;

		if (isHtml && format === "markdown") {
			text = htmlToMarkdown(raw);
			converted = true;
		} else if (isHtml && format === "text") {
			text = htmlToText(raw);
			converted = true;
		}

		const details: WebfetchDetails = {
			url: params.url,
			finalUrl: fetched.url,
			format,
			status: fetched.status,
			statusText: fetched.statusText,
			contentType: fetched.contentType,
			bytes: fetched.bytes,
			timeoutSeconds,
			converted,
			truncated: fetched.truncated,
		};

		return {
			content: [{ type: "text", text }],
			details,
		};
	},
});

export function parseWebfetchFormat(value: unknown): WebfetchFormat {
	if (value === undefined) return "markdown";
	for (const format of WEBFETCH_FORMATS) {
		if (value === format) return format;
	}
	return "markdown";
}
