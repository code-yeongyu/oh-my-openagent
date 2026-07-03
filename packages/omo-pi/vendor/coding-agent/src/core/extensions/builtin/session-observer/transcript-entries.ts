import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { getMarkdownTheme, theme } from "../../../../modes/interactive/theme/theme.ts";
import { compactWhitespace, INDENT, sanitizeLine } from "./text.ts";
import {
	contentWidth,
	formatToolArgs,
	MAX_EXPANDED_LINES,
	MAX_THINKING_COLLAPSED,
	renderMarkdown,
	renderPreview,
	toolResultText,
} from "./transcript-format.ts";
import type { TranscriptRenderOptions } from "./types.ts";

export function renderThinkingEntry(
	lines: string[],
	text: string,
	expanded: boolean,
	selected: boolean,
	options: TranscriptRenderOptions,
): void {
	const cursor = selected ? theme.fg("accent", "▶") : " ";
	lines.push("");
	lines.push(
		`${cursor} ${theme.fg("dim", "💭 Thinking")}${!expanded && text.length > MAX_THINKING_COLLAPSED ? theme.fg("dim", " ↵") : ""}`,
	);
	const displayText =
		expanded || text.length <= MAX_THINKING_COLLAPSED ? text : `${text.slice(0, MAX_THINKING_COLLAPSED)}...`;
	if (!expanded) {
		renderPreview(lines, displayText, options.width, "thinkingText");
		return;
	}
	const rendered = renderMarkdown(displayText, options.width, options.markdownTheme ?? getMarkdownTheme());
	for (const line of rendered.slice(0, MAX_EXPANDED_LINES)) lines.push(line);
	if (rendered.length > MAX_EXPANDED_LINES) {
		lines.push(`${INDENT}${theme.fg("dim", `... ${rendered.length - MAX_EXPANDED_LINES} more lines`)}`);
	}
}

export function renderTextEntry(
	lines: string[],
	label: string,
	text: string,
	expanded: boolean,
	selected: boolean,
	options: TranscriptRenderOptions,
): void {
	const cursor = selected ? theme.fg("accent", "▶") : " ";
	lines.push("");
	lines.push(`${cursor} ${theme.fg("muted", label)}`);
	if (!expanded) {
		renderPreview(lines, text, options.width, "dim");
		return;
	}
	for (const line of renderMarkdown(text, options.width, options.markdownTheme ?? getMarkdownTheme()))
		lines.push(line);
}

export function renderUserEntry(
	lines: string[],
	label: string,
	text: string,
	expanded: boolean,
	selected: boolean,
	options: TranscriptRenderOptions,
): void {
	const cursor = selected ? theme.fg("accent", "▶") : " ";
	lines.push("");
	if (expanded) {
		lines.push(`${cursor} ${theme.fg("dim", `[${label}]`)}`);
		for (const line of renderMarkdown(text, options.width, options.markdownTheme ?? getMarkdownTheme()))
			lines.push(line);
		return;
	}
	const normalized = compactWhitespace(text);
	lines.push(
		`${cursor} ${theme.fg("dim", `[${label}]`)} ${theme.fg("muted", sanitizeLine(normalized, contentWidth(options.width)))}`,
	);
}

function renderToolResult(
	lines: string[],
	result: ToolResultMessage<unknown> | undefined,
	expanded: boolean,
	options: TranscriptRenderOptions,
): void {
	if (!result) return;
	const text = toolResultText(result);
	if (!text) {
		lines.push(`${INDENT}${theme.fg("success", "✓ done")}`);
		return;
	}
	const resultLines = text.split("\n");
	const maxLines = expanded ? 20 : 3;
	const color = result.isError ? "error" : "dim";
	const marker = result.isError ? "✗" : "✓";
	lines.push(
		`${INDENT}${theme.fg(result.isError ? "error" : "success", marker)} ${theme.fg(color, sanitizeLine(resultLines[0] ?? "", contentWidth(options.width)))}`,
	);
	for (const line of resultLines.slice(1, maxLines)) {
		lines.push(`${INDENT}  ${theme.fg(color, sanitizeLine(line, contentWidth(options.width)))}`);
	}
	if (resultLines.length > maxLines)
		lines.push(`${INDENT}  ${theme.fg("dim", `... ${resultLines.length - maxLines} more`)}`);
}

export function renderToolEntry(
	lines: string[],
	call: ToolCall,
	result: ToolResultMessage<unknown> | undefined,
	expanded: boolean,
	selected: boolean,
	options: TranscriptRenderOptions,
): void {
	const cursor = selected ? theme.fg("accent", "▶") : " ";
	lines.push("");
	lines.push(`${cursor} ${theme.fg("accent", "▸")} ${theme.bold(theme.fg("muted", call.name))}`);
	const args = formatToolArgs(call);
	if (args) lines.push(`${INDENT}${theme.fg("dim", sanitizeLine(args, contentWidth(options.width)))}`);
	renderToolResult(lines, result, expanded, options);
}
