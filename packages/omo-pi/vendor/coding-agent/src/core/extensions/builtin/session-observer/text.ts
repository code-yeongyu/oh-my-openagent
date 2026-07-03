import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { truncateToWidth } from "@earendil-works/pi-tui";

export const INDENT = "    ";

export function sanitizeLine(text: string, width: number): string {
	return truncateToWidth(text.replace(/\t/g, "   ").replace(/\r/g, ""), Math.max(1, width), "…");
}

export function compactWhitespace(text: string): string {
	return text.replace(/[\r\n\t ]+/g, " ").trim();
}

export function getTextContent(content: string | readonly (TextContent | ImageContent)[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export function formatSessionDate(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMs / 3_600_000);
	const diffDays = Math.floor(diffMs / 86_400_000);

	if (diffMins < 1) return "now";
	if (diffMins < 60) return `${diffMins}m`;
	if (diffHours < 24) return `${diffHours}h`;
	if (diffDays < 7) return `${diffDays}d`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
	if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
	return `${Math.floor(diffDays / 365)}y`;
}
