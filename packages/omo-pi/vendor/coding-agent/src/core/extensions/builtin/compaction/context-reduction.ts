/**
 * Deterministic, no-LLM context reductions applied before compaction summarization.
 *
 * Ported from plugsuits' `context-collapse` and `micro-compact` patterns and
 * adapted to the senpi `AgentMessage` shape. Three independent transforms:
 *
 *  1. {@link collapseConsecutiveToolResults} — runs of same-kind read/grep/shell
 *     tool result payloads are replaced with a single one-line label so the
 *     summarizer pays for the shape, not for the bytes.
 *  2. {@link microCompactAssistantText} — older long assistant text answers are
 *     truncated and tagged with a `[response shrunk]` marker.
 *  3. {@link clearOldToolResults} — keep the last N tool results in full, replace
 *     older clearable tool result content with `[tool result cleared]`.
 *
 * Each transform is pure (`messages` in → new array out, no in-place mutation
 * beyond freshly cloned messages) and returns aggregated token-savings stats.
 *
 * {@link reduceContextMessages} composes the three transforms in order.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";

const DEFAULT_READ_TOOL_NAMES = ["read", "Read", "read_file"];
const DEFAULT_SEARCH_TOOL_NAMES = ["grep", "Grep", "glob", "Glob"];
const DEFAULT_SHELL_TOOL_NAMES = ["bash", "Bash", "shell", "shell_execute"];
const DEFAULT_CLEARABLE_TOOL_NAMES = [
	"read",
	"Read",
	"read_file",
	"write",
	"Write",
	"edit",
	"Edit",
	"grep",
	"Grep",
	"glob",
	"Glob",
	"bash",
	"Bash",
	"shell",
];

const DEFAULT_MIN_GROUP_SIZE = 2;
const DEFAULT_PROTECT_RECENT_MESSAGES = 5;
const DEFAULT_PROTECT_RECENT_TOKENS = 2000;
const DEFAULT_MAX_ASSISTANT_TEXT_TOKENS = 500;
const DEFAULT_MIN_SAVINGS_TOKENS = 100;
const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 3;
const DEFAULT_CLEARED_PLACEHOLDER = "[tool result cleared]";
const DEFAULT_REPLACEMENT_TEMPLATE = "[response shrunk — {original_tokens} → {shrunk_tokens} tokens]";

const MAX_HINTS_IN_LABEL = 5;
const MAX_HINT_LENGTH = 80;
const SHRUNK_RESPONSE_RATIO = 0.3;

export type CollapsedGroupKind = "read" | "search" | "shell";

export interface CollapsedGroup {
	type: CollapsedGroupKind;
	count: number;
	label: string;
	originalTokens: number;
	collapsedTokens: number;
}

export interface CollapseConsecutiveOptions {
	minGroupSize?: number;
	protectRecentMessages?: number;
	readToolNames?: string[];
	searchToolNames?: string[];
	shellToolNames?: string[];
}

export interface CollapseConsecutiveResult {
	messages: AgentMessage[];
	groups: CollapsedGroup[];
	tokensSaved: number;
}

export interface MicroCompactAssistantOptions {
	protectRecentTokens?: number;
	maxAssistantTextTokens?: number;
	minSavingsTokens?: number;
	replacementTemplate?: string;
}

export interface MicroCompactAssistantResult {
	messages: AgentMessage[];
	tokensSaved: number;
	messagesModified: number;
}

export interface ClearOldToolResultsOptions {
	keepRecent?: number;
	clearableToolNames?: string[];
	replacementText?: string;
}

export interface ClearOldToolResultsResult {
	messages: AgentMessage[];
	tokensSaved: number;
	toolResultsCleared: number;
}

export interface ReduceContextOptions {
	collapse?: false | CollapseConsecutiveOptions;
	shrinkAssistant?: false | MicroCompactAssistantOptions;
	clearToolResults?: false | ClearOldToolResultsOptions;
}

export interface ReduceContextResult {
	messages: AgentMessage[];
	tokensSaved: number;
	groupsCollapsed: number;
	messagesShrunk: number;
	toolResultsCleared: number;
}

/**
 * Default options passed to {@link reduceContextMessages} when the builtin
 * compaction extension's `context` hook decides to run a reduction pass.
 *
 * Each value is chosen to be strictly more conservative than the corresponding
 * plugsuits default — protect more of the recent tail, raise the per-message
 * shrink threshold, and keep more recent tool results intact — so a single
 * shared default is safe to apply across normal coding sessions without making
 * targeted reductions less effective.
 */
export const BUILTIN_CONTEXT_REDUCTION_OPTIONS: ReduceContextOptions = {
	collapse: {
		minGroupSize: DEFAULT_MIN_GROUP_SIZE,
		protectRecentMessages: DEFAULT_PROTECT_RECENT_MESSAGES,
	},
	shrinkAssistant: {
		protectRecentTokens: 3000,
		maxAssistantTextTokens: 800,
		minSavingsTokens: DEFAULT_MIN_SAVINGS_TOKENS,
	},
	clearToolResults: {
		keepRecent: 6,
	},
};

export const BUILTIN_CONTEXT_REDUCTION_GATE_RATIO = 0.5;

export interface ShouldApplyContextReductionInput {
	usageTokens: number | null;
	contextWindow: number;
	gateRatio?: number;
	isProviderNativeCompactionPath?: boolean;
}

export function shouldApplyContextReduction(input: ShouldApplyContextReductionInput): boolean {
	const gate = input.gateRatio ?? BUILTIN_CONTEXT_REDUCTION_GATE_RATIO;
	if (input.isProviderNativeCompactionPath === true) return false;
	if (input.usageTokens === null) return false;
	if (input.contextWindow <= 0) return false;
	return input.usageTokens >= input.contextWindow * gate;
}

function approxTextTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function extractContentText(content: (TextContent | ImageContent)[] | undefined): string {
	if (!Array.isArray(content)) return "";
	let out = "";
	for (const part of content) {
		if (part.type === "text") out += part.text;
	}
	return out;
}

function extractMessageText(message: AgentMessage): string {
	if (message.role === "user") {
		if (typeof message.content === "string") return message.content;
		return extractContentText(message.content as (TextContent | ImageContent)[]);
	}
	if (message.role === "assistant") {
		let out = "";
		for (const block of message.content) {
			if (block.type === "text") out += block.text;
			else if (block.type === "toolCall") out += `${block.name} ${JSON.stringify(block.arguments)}`;
		}
		return out;
	}
	if (message.role === "toolResult") {
		return extractContentText(message.content);
	}
	return "";
}

interface ToolNameSets {
	read: Set<string>;
	search: Set<string>;
	shell: Set<string>;
}

function classifyTool(name: string, sets: ToolNameSets): CollapsedGroupKind | null {
	if (sets.read.has(name)) return "read";
	if (sets.search.has(name)) return "search";
	if (sets.shell.has(name)) return "shell";
	return null;
}

interface FirstToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

function getFirstToolCallFromAssistant(message: AgentMessage): FirstToolCall | null {
	if (message.role !== "assistant") return null;
	for (const block of message.content) {
		if (block.type === "toolCall") {
			return { id: block.id, name: block.name, args: block.arguments as Record<string, unknown> };
		}
	}
	return null;
}

interface CollapsibleOperation {
	type: CollapsedGroupKind;
	toolName: string;
	assistantIndex: number;
	resultIndex: number;
	hint?: string;
	resultText: string;
}

function truncateHint(value: string): string {
	if (value.length <= MAX_HINT_LENGTH) return value;
	return `${value.slice(0, MAX_HINT_LENGTH - 1)}…`;
}

function extractHint(type: CollapsedGroupKind, args: Record<string, unknown>): string | undefined {
	if (type === "read") {
		const path = args.path ?? args.file_path ?? args.filePath;
		if (typeof path === "string" && path.length > 0) return truncateHint(path);
		return undefined;
	}
	if (type === "search") {
		const path = typeof args.path === "string" ? args.path : undefined;
		const pattern =
			(typeof args.pattern === "string" && args.pattern) ||
			(typeof args.glob === "string" && args.glob) ||
			(typeof args.query === "string" && args.query) ||
			undefined;
		if (path && pattern) return truncateHint(`${path}:${pattern}`);
		if (path) return truncateHint(path);
		if (pattern) return truncateHint(pattern as string);
		return undefined;
	}
	const command = args.command ?? args.cmd;
	if (typeof command === "string" && command.length > 0) return truncateHint(command);
	return undefined;
}

function buildGroupLabel(type: CollapsedGroupKind, operations: CollapsibleOperation[]): string {
	const hints: string[] = [];
	for (const op of operations) {
		if (op.hint && hints.length < MAX_HINTS_IN_LABEL) hints.push(op.hint);
	}
	const noun = type === "read" ? "read results" : type === "search" ? "search results" : "shell results";
	if (hints.length === 0) return `[${operations.length} ${noun}]`;
	const more = operations.length - hints.length;
	const moreSuffix = more > 0 ? `, and ${more} more` : "";
	return `[${operations.length} ${noun}: ${hints.join(", ")}${moreSuffix}]`;
}

function collectCollapsibleOperations(
	messages: AgentMessage[],
	collapseLimit: number,
	sets: ToolNameSets,
): CollapsibleOperation[] {
	const operations: CollapsibleOperation[] = [];
	let i = 0;
	while (i < collapseLimit) {
		const assistant = messages[i];
		const call = getFirstToolCallFromAssistant(assistant);
		if (!call) {
			i += 1;
			continue;
		}
		const next = messages[i + 1];
		const resultInWindow = i + 1 < collapseLimit;
		if (next?.role !== "toolResult" || next.toolCallId !== call.id || !resultInWindow) {
			i += 1;
			continue;
		}
		const type = classifyTool(call.name, sets);
		if (!type) {
			i += 1;
			continue;
		}
		operations.push({
			type,
			toolName: call.name,
			assistantIndex: i,
			resultIndex: i + 1,
			hint: extractHint(type, call.args),
			resultText: extractContentText((next as ToolResultMessage).content),
		});
		i += 2;
	}
	return operations;
}

function groupConsecutiveOperations(operations: CollapsibleOperation[]): CollapsibleOperation[][] {
	const groups: CollapsibleOperation[][] = [];
	let current: CollapsibleOperation[] = [];
	for (const op of operations) {
		if (current.length === 0) {
			current.push(op);
			continue;
		}
		const prev = current[current.length - 1];
		if (op.type === prev.type && op.assistantIndex === prev.resultIndex + 1) {
			current.push(op);
			continue;
		}
		groups.push(current);
		current = [op];
	}
	if (current.length > 0) groups.push(current);
	return groups;
}

export function collapseConsecutiveToolResults(
	messages: AgentMessage[],
	options: CollapseConsecutiveOptions = {},
): CollapseConsecutiveResult {
	const minGroupSize = Math.max(1, options.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE);
	const protectRecentMessages = Math.max(0, options.protectRecentMessages ?? DEFAULT_PROTECT_RECENT_MESSAGES);
	const sets: ToolNameSets = {
		read: new Set(options.readToolNames ?? DEFAULT_READ_TOOL_NAMES),
		search: new Set(options.searchToolNames ?? DEFAULT_SEARCH_TOOL_NAMES),
		shell: new Set(options.shellToolNames ?? DEFAULT_SHELL_TOOL_NAMES),
	};

	const collapseLimit = Math.max(0, messages.length - protectRecentMessages);
	const operations = collectCollapsibleOperations(messages, collapseLimit, sets);
	const operationGroups = groupConsecutiveOperations(operations);

	const collapsedGroups: CollapsedGroup[] = [];
	const nextMessages = messages.slice();
	let tokensSaved = 0;

	for (const group of operationGroups) {
		if (group.length < minGroupSize) continue;
		const label = buildGroupLabel(group[0].type, group);
		let originalTokens = 0;
		let collapsedTokens = 0;
		for (const op of group) {
			const original = approxTextTokens(op.resultText);
			const collapsed = approxTextTokens(label);
			originalTokens += original;
			collapsedTokens += collapsed;
			const result = nextMessages[op.resultIndex];
			if (result.role !== "toolResult") continue;
			const images = result.content.filter((c): c is ImageContent => c.type === "image");
			nextMessages[op.resultIndex] = {
				...result,
				content: [{ type: "text", text: label } as TextContent, ...images],
			};
		}
		tokensSaved += Math.max(0, originalTokens - collapsedTokens);
		collapsedGroups.push({
			type: group[0].type,
			count: group.length,
			label,
			originalTokens,
			collapsedTokens,
		});
	}

	return { messages: nextMessages, groups: collapsedGroups, tokensSaved };
}

function resolveProtectedFromIndex(messages: AgentMessage[], protectRecentTokens: number): number {
	if (messages.length === 0) return 0;
	let recentTokens = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const tokens = approxTextTokens(extractMessageText(messages[i]));
		if (recentTokens + tokens > protectRecentTokens) return i + 1;
		recentTokens += tokens;
		if (i === 0) return 0;
	}
	return messages.length;
}

function renderReplacementText(template: string, originalTokens: number, shrunkTokens: number): string {
	return template
		.split("{original_tokens}")
		.join(String(originalTokens))
		.split("{shrunk_tokens}")
		.join(String(shrunkTokens));
}

function buildShrunkText(
	originalText: string,
	originalTokens: number,
	maxAssistantTextTokens: number,
	template: string,
): { text: string; tokens: number } {
	const targetTextTokens = Math.max(1, Math.floor(maxAssistantTextTokens * SHRUNK_RESPONSE_RATIO));
	const ratio = originalTokens > 0 ? targetTextTokens / originalTokens : 0;
	const targetChars = Math.max(0, Math.floor(originalText.length * ratio));
	const truncatedText = originalText.slice(0, targetChars);
	let shrunkTokens = 0;
	let shrunkText = "";
	for (let iteration = 0; iteration < 5; iteration += 1) {
		const replacement = renderReplacementText(template, originalTokens, shrunkTokens);
		const candidate = truncatedText.length > 0 ? `${truncatedText}\n\n${replacement}` : replacement;
		const tokens = approxTextTokens(candidate);
		shrunkText = candidate;
		if (tokens === shrunkTokens) return { text: candidate, tokens };
		shrunkTokens = tokens;
	}
	return { text: shrunkText, tokens: approxTextTokens(shrunkText) };
}

export function microCompactAssistantText(
	messages: AgentMessage[],
	options: MicroCompactAssistantOptions = {},
): MicroCompactAssistantResult {
	const protectRecentTokens = Math.max(0, options.protectRecentTokens ?? DEFAULT_PROTECT_RECENT_TOKENS);
	const maxAssistantTextTokens = Math.max(0, options.maxAssistantTextTokens ?? DEFAULT_MAX_ASSISTANT_TEXT_TOKENS);
	const minSavingsTokens = Math.max(0, options.minSavingsTokens ?? DEFAULT_MIN_SAVINGS_TOKENS);
	const template = options.replacementTemplate ?? DEFAULT_REPLACEMENT_TEMPLATE;

	const protectedFromIndex = resolveProtectedFromIndex(messages, protectRecentTokens);
	const result = messages.slice();
	let messagesModified = 0;
	let tokensSaved = 0;

	for (let i = 0; i < protectedFromIndex; i += 1) {
		const msg = result[i];
		if (msg.role !== "assistant") continue;
		const assistant = msg as AssistantMessage;
		const allText = assistant.content.length > 0 && assistant.content.every((c) => c.type === "text");
		if (!allText) continue;
		const originalText = assistant.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
		const originalTokens = approxTextTokens(originalText);
		if (originalTokens <= maxAssistantTextTokens) continue;
		const shrunk = buildShrunkText(originalText, originalTokens, maxAssistantTextTokens, template);
		const saved = originalTokens - shrunk.tokens;
		if (saved < minSavingsTokens) continue;
		result[i] = {
			...assistant,
			content: [{ type: "text", text: shrunk.text } as TextContent],
		};
		tokensSaved += saved;
		messagesModified += 1;
	}

	return { messages: result, tokensSaved, messagesModified };
}

export function clearOldToolResults(
	messages: AgentMessage[],
	options: ClearOldToolResultsOptions = {},
): ClearOldToolResultsResult {
	const keepRecent = Math.max(0, options.keepRecent ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS);
	const clearable = new Set(options.clearableToolNames ?? DEFAULT_CLEARABLE_TOOL_NAMES);
	const replacementText = options.replacementText ?? DEFAULT_CLEARED_PLACEHOLDER;

	const clearableIndices: number[] = [];
	for (let i = 0; i < messages.length; i += 1) {
		const msg = messages[i];
		if (msg.role === "toolResult" && clearable.has(msg.toolName)) {
			clearableIndices.push(i);
		}
	}

	const clearUntil = Math.max(0, clearableIndices.length - keepRecent);
	if (clearUntil === 0) {
		return { messages: messages.slice(), tokensSaved: 0, toolResultsCleared: 0 };
	}

	const result = messages.slice();
	let tokensSaved = 0;
	let toolResultsCleared = 0;
	const replacementTokens = approxTextTokens(replacementText);

	for (let k = 0; k < clearUntil; k += 1) {
		const idx = clearableIndices[k];
		const msg = result[idx];
		if (msg.role !== "toolResult") continue;
		const original = msg as ToolResultMessage;
		const originalText = extractContentText(original.content);
		const originalTokens = approxTextTokens(originalText);
		const images = original.content.filter((c): c is ImageContent => c.type === "image");
		result[idx] = {
			...original,
			content: [{ type: "text", text: replacementText } as TextContent, ...images],
		};
		const savings = originalTokens - replacementTokens;
		if (savings > 0) tokensSaved += savings;
		toolResultsCleared += 1;
	}

	return { messages: result, tokensSaved, toolResultsCleared };
}

export function reduceContextMessages(
	messages: AgentMessage[],
	options: ReduceContextOptions = {},
): ReduceContextResult {
	let current = messages;
	let tokensSaved = 0;
	let groupsCollapsed = 0;
	let messagesShrunk = 0;
	let toolResultsCleared = 0;

	if (options.collapse !== false) {
		const collapsed = collapseConsecutiveToolResults(current, options.collapse ?? undefined);
		current = collapsed.messages;
		tokensSaved += collapsed.tokensSaved;
		groupsCollapsed += collapsed.groups.length;
	}
	if (options.shrinkAssistant !== false) {
		const shrunk = microCompactAssistantText(current, options.shrinkAssistant ?? undefined);
		current = shrunk.messages;
		tokensSaved += shrunk.tokensSaved;
		messagesShrunk += shrunk.messagesModified;
	}
	if (options.clearToolResults !== false) {
		const cleared = clearOldToolResults(current, options.clearToolResults ?? undefined);
		current = cleared.messages;
		tokensSaved += cleared.tokensSaved;
		toolResultsCleared += cleared.toolResultsCleared;
	}

	return { messages: current, tokensSaved, groupsCollapsed, messagesShrunk, toolResultsCleared };
}
