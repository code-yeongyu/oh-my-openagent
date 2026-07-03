import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

const PER_RESULT_TRUNCATE_THRESHOLD_BYTES = 4096;
const TRUNCATION_HEAD_CHARS = 800;
const TRUNCATION_TAIL_CHARS = 400;
const TRUNCATION_MARKER_RE = /<truncated:\d+ bytes original>/;

function utf8Bytes(text: string): number {
	return new TextEncoder().encode(text).length;
}

function approxTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function totalTokens(results: AgentToolResult<unknown>[]): number {
	let total = 0;
	for (const result of results) {
		for (const block of result.content) {
			if (block.type === "text") {
				total += approxTokens(block.text);
				continue;
			}
			if (block.type === "image") {
				total += approxTokens(block.data);
			}
		}
	}
	return total;
}

function buildMarker(originalBytes: number): string {
	return `<truncated:${originalBytes} bytes original>`;
}

function truncateTextBlock(block: TextContent, headChars: number, tailChars: number): TextContent | null {
	const text = block.text;
	const bytes = utf8Bytes(text);
	if (bytes <= PER_RESULT_TRUNCATE_THRESHOLD_BYTES) return null;
	if (TRUNCATION_MARKER_RE.test(text)) return null;
	const head = text.slice(0, headChars);
	const tail = text.slice(text.length - tailChars);
	const marker = buildMarker(bytes);
	return { ...block, text: `${head}\n${marker}\n${tail}` };
}

function applyHeadTailTruncation(
	result: AgentToolResult<unknown>,
	headChars: number,
	tailChars: number,
): AgentToolResult<unknown> {
	let modified = false;
	const newContent: (TextContent | ImageContent)[] = result.content.map((block) => {
		if (block.type !== "text") return block;
		const truncated = truncateTextBlock(block, headChars, tailChars);
		if (truncated) {
			modified = true;
			return truncated;
		}
		return block;
	});
	if (!modified) return result;
	return { ...result, content: newContent };
}

function reduceMarkedTextToMarker(result: AgentToolResult<unknown>): AgentToolResult<unknown> {
	let modified = false;
	const newContent: (TextContent | ImageContent)[] = result.content.map((block) => {
		if (block.type !== "text") return block;
		const markerMatch = block.text.match(TRUNCATION_MARKER_RE);
		if (markerMatch && block.text !== markerMatch[0]) {
			modified = true;
			return { ...block, text: markerMatch[0] };
		}
		return block;
	});
	if (!modified) return result;
	return { ...result, content: newContent };
}

export function truncateOversizedToolResults(results: AgentToolResult<unknown>[]): AgentToolResult<unknown>[] {
	return results.map((result) => applyHeadTailTruncation(result, TRUNCATION_HEAD_CHARS, TRUNCATION_TAIL_CHARS));
}

export function prePruneToolOutputsToBudget(
	results: AgentToolResult<unknown>[],
	targetTokens: number,
): AgentToolResult<unknown>[] {
	if (totalTokens(results) <= targetTokens) {
		return results.map((result) => ({ ...result }));
	}

	const firstPass = truncateOversizedToolResults(results);
	if (totalTokens(firstPass) <= targetTokens) return firstPass;

	return firstPass.map((result) => reduceMarkedTextToMarker(result));
}
