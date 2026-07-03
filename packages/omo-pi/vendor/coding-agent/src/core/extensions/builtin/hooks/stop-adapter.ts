import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "../../types.ts";
import { diagnostic } from "./diagnostics.ts";
import type { HookDispatchResult, HookDispatchSummary } from "./dispatcher.ts";
import { safeDiagnosticDetails } from "./prompt-adapter.ts";
import type { HookDiagnostic, HookInputWire } from "./types.ts";

export const STOP_STATE_CUSTOM_TYPE = "senpi.hooks.stop-state";
export const STOP_DIAGNOSTICS_CUSTOM_TYPE = "senpi.hooks.stop-diagnostics";
export const STOP_OUTPUT_CUSTOM_TYPE = "senpi.hooks.stop-output";

const STOP_REENTRY_LIMIT = 8;

type StopState = {
	readonly sessionId: string;
	readonly turnKey: string;
	readonly count: number;
};

type StopOutputRecord = {
	readonly event: "Stop";
	readonly exitCode: number | null;
	readonly fields: readonly string[];
	readonly sourcePath: string;
};

type StopRuntime = Pick<ExtensionAPI, "appendEntry" | "sendUserMessage">;

export function buildStopHookInput(
	event: { readonly messages: readonly AgentMessage[] },
	ctx: ExtensionContext,
): HookInputWire {
	const transcriptPath = ctx.sessionManager.getSessionFile();
	const stopReason = findLastAssistantStopReason(event.messages);
	return {
		cwd: ctx.cwd,
		event: "Stop",
		hook_event_name: "Stop",
		session_id: ctx.sessionManager.getSessionId(),
		...(stopReason === undefined ? {} : { stopReason }),
		...(transcriptPath === undefined ? {} : { transcript_path: transcriptPath }),
	};
}

export function createStopTurnTracker(): {
	readonly reset: () => void;
	readonly turnKey: (ctx: ExtensionContext) => string;
} {
	let activeTurnKey: string | undefined;
	let turnIndex = 0;
	return {
		reset() {
			turnIndex += 1;
			activeTurnKey = undefined;
		},
		turnKey(ctx) {
			if (activeTurnKey !== undefined) return activeTurnKey;
			const leafId = ctx.sessionManager.getLeafId() ?? ctx.sessionManager.getSessionId();
			activeTurnKey = `${turnIndex}:${leafId}`;
			return activeTurnKey;
		},
	};
}

export function applyStopHookResult(
	pi: StopRuntime,
	ctx: ExtensionContext,
	result: HookDispatchResult,
	turnKey: string,
): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	const previous = latestStopState(ctx, sessionId, turnKey);
	if (previous.count >= STOP_REENTRY_LIMIT) {
		appendStopState(pi, { count: previous.count, sessionId, turnKey });
		appendStopDiagnostics(pi, [
			diagnostic(
				{
					code: "unsupported_event",
					event: "Stop",
					message: "Stop hook reentry limit reached.",
					path: "hooks.Stop",
					severity: "warning",
				},
				limitDiagnosticSource(result),
			),
		]);
		return Promise.resolve();
	}

	const unsupportedDiagnostics = unsupportedStopOutputDiagnostics(result);
	if (unsupportedDiagnostics.length > 0 || result.diagnostics.length > 0) {
		appendStopDiagnostics(pi, [...result.diagnostics, ...unsupportedDiagnostics]);
	}
	appendStopOutputs(pi, stopOutputRecords(result));

	if (result.decision.kind !== "block") {
		appendStopState(pi, { count: previous.count, sessionId, turnKey });
		return Promise.resolve();
	}

	const count = previous.count + 1;
	appendStopState(pi, { count, sessionId, turnKey });
	const followUp = stopFollowUpText(result);
	if (followUp === undefined) {
		appendStopDiagnostics(pi, [
			diagnostic(
				{
					code: "unsupported_field",
					event: "Stop",
					message: "Stop hook blocked without follow-up context.",
					path: "stdout.reason",
					severity: "warning",
				},
				result.decision.source,
			),
		]);
		return Promise.resolve();
	}
	pi.sendUserMessage(followUp, { deliverAs: "followUp" });
	return waitForFollowUpQueue(ctx);
}

async function waitForFollowUpQueue(ctx: ExtensionContext): Promise<void> {
	for (let attempt = 0; attempt < 64; attempt += 1) {
		await Promise.resolve();
		if (ctx.hasPendingMessages()) return;
	}
}

function latestStopState(ctx: ExtensionContext, sessionId: string, turnKey: string): StopState {
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== STOP_STATE_CUSTOM_TYPE) continue;
		if (!isStopState(entry.data)) continue;
		if (entry.data.sessionId === sessionId && entry.data.turnKey === turnKey) return entry.data;
	}
	return { count: 0, sessionId, turnKey };
}

function appendStopState(pi: StopRuntime, state: StopState): void {
	pi.appendEntry(STOP_STATE_CUSTOM_TYPE, state);
}

function appendStopDiagnostics(pi: StopRuntime, diagnostics: readonly HookDiagnostic[]): void {
	if (diagnostics.length === 0) return;
	pi.appendEntry(STOP_DIAGNOSTICS_CUSTOM_TYPE, diagnostics.map(safeStopDiagnosticDetails));
}

function safeStopDiagnosticDetails(diagnostic: HookDiagnostic): ReturnType<typeof safeDiagnosticDetails> {
	if (
		diagnostic.code === "invalid_event_config" &&
		diagnostic.event === "Stop" &&
		diagnostic.path === "stdout.hookSpecificOutput.hookEventName"
	) {
		return {
			...safeDiagnosticDetails(diagnostic),
			message: "Hook output event does not match Stop.",
		};
	}
	return safeDiagnosticDetails(diagnostic);
}

function appendStopOutputs(pi: StopRuntime, records: readonly StopOutputRecord[]): void {
	if (records.length === 0) return;
	pi.appendEntry(STOP_OUTPUT_CUSTOM_TYPE, records);
}

function stopOutputRecords(result: HookDispatchResult): readonly StopOutputRecord[] {
	return result.summaries.flatMap((summary) => {
		const fields = stopOutputFieldPaths(summary);
		if (fields.length === 0) return [];
		return [
			{
				event: "Stop",
				exitCode: summary.run.exitCode,
				fields,
				sourcePath: summary.handler.source.sourcePath,
			},
		];
	});
}

function unsupportedStopOutputDiagnostics(result: HookDispatchResult): readonly HookDiagnostic[] {
	const diagnostics: HookDiagnostic[] = [];
	for (const summary of result.summaries) {
		diagnostics.push(...unsupportedSummaryDiagnostics(summary));
	}
	return diagnostics;
}

function unsupportedSummaryDiagnostics(summary: HookDispatchSummary): readonly HookDiagnostic[] {
	const diagnostics: HookDiagnostic[] = [];
	if (summary.output.systemMessage !== undefined) {
		diagnostics.push(unsupportedField(summary, "stdout.systemMessage", "Stop does not support systemMessage."));
	}
	if (summary.output.suppressOutput !== undefined) {
		diagnostics.push(unsupportedField(summary, "stdout.suppressOutput", "Stop does not support suppressOutput."));
	}
	if (summary.output.stopReason !== undefined) {
		diagnostics.push(unsupportedField(summary, "stdout.stopReason", "Stop output stopReason is diagnostic-only."));
	}
	if (summary.output.updatedInput !== undefined) {
		diagnostics.push(unsupportedField(summary, "stdout.updatedInput", "Stop does not support updatedInput."));
	}
	if (summary.output.updatedToolOutput !== undefined) {
		diagnostics.push(
			unsupportedField(summary, "stdout.updatedToolOutput", "Stop does not support updatedToolOutput."),
		);
	}
	for (const path of rawUnsupportedStopFieldPaths(summary)) {
		diagnostics.push(unsupportedField(summary, path, `Stop does not support ${path.replace("stdout.", "")}.`));
	}
	return diagnostics;
}

function stopOutputFieldPaths(summary: HookDispatchSummary): readonly string[] {
	const fields: string[] = [];
	if (summary.output.decision !== undefined) fields.push("stdout.decision");
	if (summary.output.reason !== undefined) fields.push("stdout.reason");
	if (summary.output.additionalContext !== undefined) {
		const raw = rawStdoutObject(summary.run.stdout);
		const specific = raw === undefined ? undefined : rawHookSpecificOutput(raw);
		fields.push(
			specific !== undefined && Object.hasOwn(specific, "additionalContext")
				? "stdout.hookSpecificOutput.additionalContext"
				: "stdout.additionalContext",
		);
	}
	if (summary.output.continue !== undefined) fields.push("stdout.continue");
	if (summary.output.stopReason !== undefined) fields.push("stdout.stopReason");
	if (summary.output.suppressOutput !== undefined) fields.push("stdout.suppressOutput");
	if (summary.output.systemMessage !== undefined) fields.push("stdout.systemMessage");
	fields.push(...rawUnsupportedStopFieldPaths(summary));
	return fields;
}

function rawUnsupportedStopFieldPaths(summary: HookDispatchSummary): readonly string[] {
	const raw = rawStdoutObject(summary.run.stdout);
	if (raw === undefined) return [];
	const fields: string[] = [];
	pushFieldIfPresent(fields, raw, "updatedInput", "stdout.updatedInput");
	pushFieldIfPresent(fields, raw, "updatedToolOutput", "stdout.updatedToolOutput");
	const specific = rawHookSpecificOutput(raw);
	if (specific !== undefined) {
		pushFieldIfPresent(fields, specific, "updatedInput", "stdout.hookSpecificOutput.updatedInput");
		pushFieldIfPresent(fields, specific, "updatedToolOutput", "stdout.hookSpecificOutput.updatedToolOutput");
	}
	return fields;
}

function pushFieldIfPresent(
	fields: string[],
	record: Readonly<Record<string, unknown>>,
	key: string,
	path: string,
): void {
	if (Object.hasOwn(record, key)) fields.push(path);
}

function rawStdoutObject(stdout: string): Readonly<Record<string, unknown>> | undefined {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return isRecord(parsed) ? parsed : undefined;
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}

function rawHookSpecificOutput(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
	const value = raw.hookSpecificOutput;
	return isRecord(value) ? value : undefined;
}

function unsupportedField(summary: HookDispatchSummary, path: string, message: string): HookDiagnostic {
	return diagnostic(
		{
			code: "unsupported_field",
			event: "Stop",
			message,
			path,
			severity: "warning",
		},
		summary.handler.source,
	);
}

function stopFollowUpText(result: HookDispatchResult): string | undefined {
	if (result.decision.kind !== "block") return undefined;
	const blocker = blockingSummary(result);
	if (blocker === undefined || blocker.run.exitCode === 2) return undefined;
	return blocker.output.additionalContext ?? result.decision.reason;
}

function blockingSummary(result: HookDispatchResult): HookDispatchSummary | undefined {
	if (result.decision.kind !== "block") return undefined;
	const sourcePath = result.decision.source.sourcePath;
	return result.summaries.find(
		(summary) =>
			summary.handler.source.sourcePath === sourcePath &&
			(summary.output.decision === "block" || summary.output.decision === "deny"),
	);
}

function limitDiagnosticSource(result: HookDispatchResult): HookDiagnostic["source"] {
	return (
		result.matchedHandlers[0]?.source ??
		result.executableHandlers[0]?.source ?? {
			discoveredAt: "runtime",
			displayOrder: 0,
			scope: "managed",
			sourcePath: "<builtin:hooks>",
		}
	);
}

function isStopState(value: unknown): value is StopState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	if (!("sessionId" in value) || !("turnKey" in value) || !("count" in value)) return false;
	return (
		typeof value.sessionId === "string" &&
		typeof value.turnKey === "string" &&
		typeof value.count === "number" &&
		Number.isInteger(value.count) &&
		value.count >= 0
	);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findLastAssistantStopReason(messages: readonly AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "assistant") return message.stopReason;
	}
	return undefined;
}
