import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionMessageEntry } from "../../../session-manager.ts";
import { getTextContent } from "./text.ts";
import { renderTextEntry, renderThinkingEntry, renderToolEntry, renderUserEntry } from "./transcript-entries.ts";
import type { RenderedTranscript, TranscriptRenderOptions, ViewerEntryRange } from "./types.ts";

function pushRange(
	ranges: ViewerEntryRange[],
	lines: readonly string[],
	start: number,
	kind: ViewerEntryRange["kind"],
): void {
	ranges.push({ lineStart: start, lineCount: lines.length - start, kind });
}

function collectToolResults(entries: readonly SessionMessageEntry[]): Map<string, ToolResultMessage<unknown>> {
	const results = new Map<string, ToolResultMessage<unknown>>();
	for (const entry of entries) {
		if (entry.message.role === "toolResult") results.set(entry.message.toolCallId, entry.message);
	}
	return results;
}

function pushAssistantRange(
	ranges: ViewerEntryRange[],
	lines: string[],
	start: number,
	blockType: "thinking" | "text" | "toolCall",
): void {
	if (blockType === "thinking") pushRange(ranges, lines, start, "thinking");
	else if (blockType === "toolCall") pushRange(ranges, lines, start, "tool");
	else pushRange(ranges, lines, start, "response");
}

export function renderTranscript(
	entries: readonly SessionMessageEntry[],
	options: TranscriptRenderOptions,
): RenderedTranscript {
	const lines: string[] = [];
	const ranges: ViewerEntryRange[] = [];
	const toolResults = collectToolResults(entries);
	let entryIndex = 0;
	for (const entry of entries) {
		const message = entry.message;
		if (message.role === "toolResult") continue;
		if (message.role === "assistant") {
			if (message.content.length === 0 && message.errorMessage) {
				const start = lines.length;
				renderTextEntry(lines, "Error", message.errorMessage, true, entryIndex === options.selectedIndex, options);
				pushRange(ranges, lines, start, "response");
				entryIndex += 1;
			}
			for (const block of message.content) {
				const start = lines.length;
				const expanded = options.expandedEntries.has(entryIndex);
				const selected = entryIndex === options.selectedIndex;
				if (block.type === "thinking" && block.thinking.trim())
					renderThinkingEntry(lines, block.thinking.trim(), expanded, selected, options);
				else if (block.type === "text" && block.text.trim())
					renderTextEntry(lines, "Response", block.text.trim(), expanded, selected, options);
				else if (block.type === "toolCall")
					renderToolEntry(lines, block, toolResults.get(block.id), expanded, selected, options);
				else continue;
				pushAssistantRange(ranges, lines, start, block.type);
				entryIndex += 1;
			}
		} else if (message.role === "user") {
			const text = getTextContent(message.content).trim();
			if (!text) continue;
			const start = lines.length;
			renderUserEntry(
				lines,
				"User",
				text,
				options.expandedEntries.has(entryIndex),
				entryIndex === options.selectedIndex,
				options,
			);
			pushRange(ranges, lines, start, "user");
			entryIndex += 1;
		} else if (message.role === "custom") {
			const text = getTextContent(message.content).trim();
			if (!text) continue;
			const start = lines.length;
			renderUserEntry(
				lines,
				message.customType,
				text,
				options.expandedEntries.has(entryIndex),
				entryIndex === options.selectedIndex,
				options,
			);
			pushRange(ranges, lines, start, "system");
			entryIndex += 1;
		} else if (message.role === "bashExecution") {
			const start = lines.length;
			renderUserEntry(
				lines,
				"Bash",
				`$ ${message.command}\n${message.output}`,
				options.expandedEntries.has(entryIndex),
				entryIndex === options.selectedIndex,
				options,
			);
			pushRange(ranges, lines, start, "tool");
			entryIndex += 1;
		}
	}
	return { lines, ranges };
}
