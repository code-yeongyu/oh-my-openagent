import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "../../types.ts";
import type { HookDispatchResult } from "./dispatcher.ts";
import type { HookInputWire } from "./types.ts";

export const PRE_TOOL_BLOCK_REASON = "PreToolUse hook blocked the tool call.";
export const POST_TOOL_BLOCK_REASON = "PostToolUse hook flagged the tool result.";

export function buildPreToolUseHookInput(event: ToolCallEvent, ctx: ExtensionContext): HookInputWire {
	return {
		event: "PreToolUse",
		toolName: event.toolName,
		toolInput: event.input,
		cwd: ctx.cwd,
		session_id: ctx.sessionManager.getSessionId(),
		hook_event_name: "PreToolUse",
		tool_name: event.toolName,
		tool_input: event.input,
		tool_use_id: event.toolCallId,
	};
}

export function buildPostToolUseHookInput(event: ToolResultEvent, ctx: ExtensionContext): HookInputWire {
	return {
		event: "PostToolUse",
		toolName: event.toolName,
		toolInput: event.input,
		toolOutput: {
			content: event.content,
			details: event.details,
			is_error: event.isError,
		},
		cwd: ctx.cwd,
		session_id: ctx.sessionManager.getSessionId(),
		hook_event_name: "PostToolUse",
		tool_name: event.toolName,
		tool_input: event.input,
		tool_response: {
			content: event.content,
			details: event.details,
			is_error: event.isError,
		},
		tool_use_id: event.toolCallId,
	};
}

export function applyPreToolUseResult(
	event: ToolCallEvent,
	result: HookDispatchResult,
): ToolCallEventResult | undefined {
	if (result.decision.kind === "block") {
		return { block: true, reason: preToolBlockReasonFromResult(result) };
	}
	if (result.decision.kind === "ask") {
		return { block: true, reason: result.decision.fallback.reason };
	}
	if (result.decision.kind === "allow" && isRecord(result.decision.updatedInput)) {
		replaceToolInput(event.input, result.decision.updatedInput);
	}
	return undefined;
}

export function applyPostToolUseResult(
	event: ToolResultEvent,
	result: HookDispatchResult,
	preToolContexts: readonly string[] = [],
): ToolResultEventResult | undefined {
	if (result.decision.kind === "block") {
		return {
			content: [
				{ type: "text", text: postToolBlockReasonFromResult(result) },
				...preToolContexts.map(contextTextPart),
				...toolContextsFromResult(result).map(contextTextPart),
			],
			details: event.details,
			isError: true,
		};
	}
	const replacement = collectPostToolUseReplacement(event, result, preToolContexts);
	return replacement;
}

export function toolContextsFromResult(result: HookDispatchResult): readonly string[] {
	return result.summaries.flatMap((summary) =>
		summary.output.additionalContext === undefined ? [] : [summary.output.additionalContext],
	);
}

function preToolBlockReasonFromResult(result: HookDispatchResult): string {
	if (result.decision.kind !== "block") return PRE_TOOL_BLOCK_REASON;
	const sourcePath = result.decision.source.sourcePath;
	const blocker = result.summaries.find(
		(summary) =>
			(summary.handler.source.sourcePath === sourcePath &&
				(summary.output.decision === "block" || summary.output.decision === "deny")) ||
			false,
	);
	if (blocker?.run.exitCode === 2) return PRE_TOOL_BLOCK_REASON;
	return result.decision.reason ?? PRE_TOOL_BLOCK_REASON;
}

function postToolBlockReasonFromResult(result: HookDispatchResult): string {
	if (result.decision.kind !== "block") return POST_TOOL_BLOCK_REASON;
	const sourcePath = result.decision.source.sourcePath;
	const blocker = result.summaries.find(
		(summary) =>
			(summary.handler.source.sourcePath === sourcePath &&
				(summary.output.decision === "block" || summary.output.decision === "deny")) ||
			false,
	);
	if (blocker?.run.exitCode === 2) return POST_TOOL_BLOCK_REASON;
	return result.decision.reason ?? POST_TOOL_BLOCK_REASON;
}

function collectPostToolUseReplacement(
	event: ToolResultEvent,
	result: HookDispatchResult,
	preToolContexts: readonly string[],
): { readonly content: (TextContent | ImageContent)[]; readonly details?: unknown } | undefined {
	let content: (TextContent | ImageContent)[] = [...event.content];
	let details: unknown = event.details;
	let replaced = false;
	const postToolContexts: string[] = [];
	for (const summary of result.summaries) {
		const updated = normalizeUpdatedToolOutput(summary.output.updatedToolOutput);
		if (updated !== undefined) {
			content = [...updated.content];
			details = updated.details;
			replaced = true;
		}
		const context = summary.output.additionalContext;
		if (context !== undefined) {
			postToolContexts.push(context);
		}
	}
	for (const context of postToolContexts) {
		content.push(contextTextPart(context));
	}
	for (const context of preToolContexts) {
		content.push(contextTextPart(context));
	}
	if (!replaced && postToolContexts.length === 0 && preToolContexts.length === 0) return undefined;
	return { content, ...(details === undefined ? {} : { details }) };
}

function normalizeUpdatedToolOutput(
	value: unknown,
): { readonly content: (TextContent | ImageContent)[]; readonly details?: unknown } | undefined {
	if (typeof value === "string") {
		return { content: [{ type: "text", text: value }] };
	}
	if (isContentArray(value)) {
		return { content: value };
	}
	if (!isRecord(value)) return undefined;
	const content = value.content;
	if (typeof content === "string") {
		return { content: [{ type: "text", text: content }], details: value.details };
	}
	if (isContentArray(content)) {
		return { content, details: value.details };
	}
	return undefined;
}

function replaceToolInput(target: Record<string, unknown>, replacement: Record<string, unknown>): void {
	for (const key of Object.keys(target)) {
		delete target[key];
	}
	Object.assign(target, replacement);
}

function contextTextPart(text: string): TextContent {
	return { type: "text", text };
}

function isContentArray(value: unknown): value is (TextContent | ImageContent)[] {
	return Array.isArray(value) && value.every(isContentPart);
}

function isContentPart(value: unknown): value is TextContent | ImageContent {
	if (!isRecord(value)) return false;
	if (value.type === "text") return typeof value.text === "string";
	return value.type === "image" && typeof value.mimeType === "string" && typeof value.data === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
