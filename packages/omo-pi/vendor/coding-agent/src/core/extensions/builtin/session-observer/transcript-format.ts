import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import { theme } from "../../../../modes/interactive/theme/theme.ts";
import { INDENT, sanitizeLine } from "./text.ts";

export const MAX_COLLAPSED_LINES = 3;
export const MAX_EXPANDED_LINES = 100;
export const MAX_THINKING_COLLAPSED = 200;

const MAX_TOOL_ARGS_CHARS = 500;

export function contentWidth(width: number): number {
	return Math.max(20, width - INDENT.length - 4);
}

export function renderMarkdown(text: string, width: number, markdownTheme: MarkdownTheme): readonly string[] {
	const markdown = new Markdown(text, 0, 0, markdownTheme);
	return markdown.render(Math.max(40, width - INDENT.length - 4)).map((line) => `${INDENT}${line.trimEnd()}`);
}

export function toolResultText(result: ToolResultMessage<unknown>): string {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch (error) {
		if (error instanceof TypeError) return "[unserializable]";
		throw error;
	}
}

export function formatToolArgs(call: ToolCall): string {
	const args = call.arguments;
	const path = args.path;
	if ((call.name === "read" || call.name === "write" || call.name === "edit") && typeof path === "string") {
		return `path: ${path}`;
	}
	const command = args.command;
	if (call.name === "bash" && typeof command === "string") return command.replace(/\t/g, "   ");
	const parts: string[] = [];
	let total = 0;
	for (const [key, value] of Object.entries(args)) {
		if (key.startsWith("_")) continue;
		const encoded = typeof value === "string" ? value : safeJson(value);
		const part = `${key}: ${encoded}`;
		if (total + part.length > MAX_TOOL_ARGS_CHARS) break;
		parts.push(part);
		total += part.length;
	}
	return parts.join(", ");
}

export function renderPreview(lines: string[], text: string, width: number, color: "dim" | "thinkingText"): void {
	const textLines = text.split("\n");
	const maxWidth = contentWidth(width);
	for (const line of textLines.slice(0, MAX_COLLAPSED_LINES)) {
		lines.push(`${INDENT}${theme.fg(color, sanitizeLine(line, maxWidth))}`);
	}
	if (textLines.length > MAX_COLLAPSED_LINES) {
		lines.push(`${INDENT}${theme.fg("dim", `... ${textLines.length - MAX_COLLAPSED_LINES} more lines`)}`);
	}
}
