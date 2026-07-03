import type {
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionCompactEvent,
	SessionStartEvent,
} from "../../types.ts";
import { diagnostic } from "./diagnostics.ts";
import { dispatchHookEvent, type HookDispatchResult } from "./dispatcher.ts";
import { HOOK_CUSTOM_MESSAGE_TYPE, safeDiagnosticDetails } from "./prompt-adapter.ts";
import { createHookTrustEntry, hookTrustId, listHookTrustRecords } from "./trust.ts";
import type { ExecutableHookHandler, HookDiagnostic, HookInputWire, HookTrustState } from "./types.ts";

type LifecycleHookEvent = "SessionStart" | "PreCompact" | "PostCompact";

type LifecycleDispatchOptions = {
	readonly cwd: string;
	readonly handlers: readonly ExecutableHookHandler[];
	readonly input: HookInputWire;
	readonly matcherInputs: readonly string[];
	readonly signal?: AbortSignal;
	readonly trustState: HookTrustState;
};

type LifecycleDispatchSelection = {
	readonly diagnostics: readonly HookDiagnostic[];
	readonly handlers: readonly ExecutableHookHandler[];
};

type LifecycleHookOutput = {
	readonly additionalContext?: string;
	readonly customInstructions?: string;
	readonly decision?: string;
	readonly reason?: string;
};

type LifecycleResultDetails = {
	readonly cancel: boolean;
	readonly contexts: readonly string[];
	readonly diagnostics: readonly HookDiagnostic[];
	readonly reason?: string;
};

export function buildSessionStartHookInput(event: SessionStartEvent, ctx: ExtensionContext): HookInputWire {
	const transcriptPath = ctx.sessionManager.getSessionFile();
	return {
		cwd: ctx.cwd,
		event: "SessionStart",
		hook_event_name: "SessionStart",
		reason: event.reason,
		sessionId: ctx.sessionManager.getSessionId(),
		session_id: ctx.sessionManager.getSessionId(),
		...(transcriptPath === undefined ? {} : { transcript_path: transcriptPath }),
	};
}

export function buildPreCompactHookInput(event: SessionBeforeCompactEvent, ctx: ExtensionContext): HookInputWire {
	const transcriptPath = ctx.sessionManager.getSessionFile();
	return {
		cwd: ctx.cwd,
		event: "PreCompact",
		hook_event_name: "PreCompact",
		reason: event.reason,
		request_id: event.requestId,
		session_id: ctx.sessionManager.getSessionId(),
		will_retry: event.willRetry,
		...(event.customInstructions === undefined ? {} : { custom_instructions: event.customInstructions }),
		...(transcriptPath === undefined ? {} : { transcript_path: transcriptPath }),
	};
}

export function buildPostCompactHookInput(event: SessionCompactEvent, ctx: ExtensionContext): HookInputWire {
	const transcriptPath = ctx.sessionManager.getSessionFile();
	return {
		accepted: event.accepted,
		cwd: ctx.cwd,
		event: "PostCompact",
		hook_event_name: "PostCompact",
		reason: event.reason,
		request_id: event.requestId,
		session_id: ctx.sessionManager.getSessionId(),
		will_retry: event.willRetry,
		...(transcriptPath === undefined ? {} : { transcript_path: transcriptPath }),
	};
}

export async function dispatchLifecycleHookEvent(
	options: LifecycleDispatchOptions,
): Promise<HookDispatchResult | undefined> {
	const selection = selectLifecycleHandlers(options);
	if (selection.handlers.length === 0 && selection.diagnostics.length === 0) return undefined;
	const trustedHandlers = selection.handlers.map((handler) => stripLifecycleMatcher(handler));
	const hooks: Record<string, ReturnType<typeof createHookTrustEntry>> = {};
	for (const handler of trustedHandlers) {
		hooks[hookTrustId(handler)] = createHookTrustEntry(handler, {
			platform: process.platform,
			updatedAt: "2026-06-29T00:00:00.000Z",
		});
	}
	const result = await dispatchHookEvent({
		cwd: options.cwd,
		handlers: trustedHandlers,
		input: options.input,
		...(options.signal === undefined ? {} : { signal: options.signal }),
		trustOptions: { platform: process.platform },
		trustState: { hooks, version: 1 },
	});
	return {
		...result,
		diagnostics: [...selection.diagnostics, ...result.diagnostics],
	};
}

export function sessionStartResultDetails(result: HookDispatchResult | undefined): LifecycleResultDetails {
	return lifecycleResultDetails("SessionStart", result);
}

export function preCompactResultDetails(result: HookDispatchResult | undefined): LifecycleResultDetails {
	const details = lifecycleResultDetails("PreCompact", result);
	if (details.cancel) return details;
	const blocker = result?.summaries.find((summary) => {
		const output = readLifecycleHookOutput("PreCompact", summary.run.stdout);
		return output?.decision === "block" || output?.decision === "deny";
	});
	if (blocker === undefined) return details;
	const output = readLifecycleHookOutput("PreCompact", blocker.run.stdout);
	return {
		...details,
		cancel: true,
		...(output?.reason === undefined ? {} : { reason: output.reason }),
	};
}

export function postCompactResultDetails(result: HookDispatchResult | undefined): LifecycleResultDetails {
	return lifecycleResultDetails("PostCompact", result);
}

export function sessionBeforeCompactResult(details: LifecycleResultDetails): SessionBeforeCompactResult | undefined {
	return details.cancel ? { cancel: true } : undefined;
}

export function recordLifecycleHookResult(
	pi: Pick<ExtensionAPI, "sendMessage">,
	event: LifecycleHookEvent,
	details: LifecycleResultDetails,
): void {
	if (details.contexts.length === 0 && details.diagnostics.length === 0 && details.reason === undefined) return;
	const content =
		details.contexts.length > 0 ? details.contexts.join("\n\n") : (details.reason ?? `${event} hook diagnostics.`);
	pi.sendMessage(
		{
			customType: HOOK_CUSTOM_MESSAGE_TYPE,
			content,
			display: false,
			details: {
				event,
				diagnostics: details.diagnostics.map(safeDiagnosticDetails),
			},
		},
		{ triggerTurn: false },
	);
}

function selectLifecycleHandlers(options: LifecycleDispatchOptions): LifecycleDispatchSelection {
	const matched: ExecutableHookHandler[] = [];
	const diagnostics: HookDiagnostic[] = [];
	for (const handler of options.handlers) {
		if (handler.event !== options.input.event) continue;
		if (isInitialRuntimeSessionStart(handler, options.input)) {
			diagnostics.push(
				diagnostic(
					{
						code: "unsupported_event",
						event: "SessionStart",
						message: "Runtime SessionStart hooks are loaded for reload or the next session only.",
						path: "hooks.SessionStart",
						severity: "warning",
					},
					handler.source,
				),
			);
			continue;
		}
		const match = matchesLifecycleMatcher(handler, options.matcherInputs);
		diagnostics.push(...match.diagnostics);
		if (match.matched) matched.push(handler);
	}
	const trustRecords = listHookTrustRecords(matched, options.trustState, { platform: process.platform });
	const trusted = matched.filter((_handler, index) => trustRecords[index]?.executable === true);
	return { diagnostics, handlers: trusted };
}

function isInitialRuntimeSessionStart(handler: ExecutableHookHandler, input: HookInputWire): boolean {
	return input.event === "SessionStart" && input.reason === "startup" && handler.source.discoveredAt === "runtime";
}

function matchesLifecycleMatcher(
	handler: ExecutableHookHandler,
	inputs: readonly string[],
): { readonly diagnostics: readonly HookDiagnostic[]; readonly matched: boolean } {
	const matcher = handler.matcher?.trim();
	if (matcher === undefined || matcher.length === 0 || matcher === "*") {
		return { diagnostics: [], matched: true };
	}
	const literalMatched = matcher
		.split(/[|,]/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.some((part) => inputs.includes(part));
	try {
		const regex = new RegExp(matcher);
		return { diagnostics: [], matched: literalMatched || inputs.some((input) => regex.test(input)) };
	} catch (error) {
		if (error instanceof SyntaxError) {
			return {
				diagnostics: [
					diagnostic(
						{
							code: "invalid_matcher",
							event: handler.event,
							message: `Hook matcher is not a valid JavaScript regular expression: ${error.message}`,
							path: `hooks.${handler.event}[${handler.groupIndex}].matcher`,
							severity: "warning",
						},
						handler.source,
					),
				],
				matched: literalMatched,
			};
		}
		throw error;
	}
}

function stripLifecycleMatcher(handler: ExecutableHookHandler): ExecutableHookHandler {
	return {
		config: handler.config,
		event: handler.event,
		groupIndex: handler.groupIndex,
		handlerIndex: handler.handlerIndex,
		source: handler.source,
	};
}

function lifecycleResultDetails(
	event: LifecycleHookEvent,
	result: HookDispatchResult | undefined,
): LifecycleResultDetails {
	if (result === undefined) {
		return { cancel: false, contexts: [], diagnostics: [] };
	}
	const diagnostics = [...result.diagnostics, ...commandFailureDiagnostics(event, result)];
	const contexts: string[] = [];
	for (const summary of result.summaries) {
		const output = readLifecycleHookOutput(event, summary.run.stdout);
		if (output?.additionalContext !== undefined && event !== "PreCompact") {
			contexts.push(output.additionalContext);
		}
		if (event === "PreCompact") {
			diagnostics.push(...preCompactUnsupportedDiagnostics(summary.handler, output));
		}
	}
	const reason = event === "PreCompact" && result.decision.kind === "block" ? result.decision.reason : undefined;
	return {
		cancel: event === "PreCompact" && result.decision.kind === "block",
		contexts,
		diagnostics,
		...(reason === undefined ? {} : { reason }),
	};
}

function commandFailureDiagnostics(event: LifecycleHookEvent, result: HookDispatchResult): readonly HookDiagnostic[] {
	return result.summaries.flatMap((summary) => {
		if (summary.run.exitCode === 0 || (summary.run.exitCode === 2 && event === "PreCompact")) return [];
		const status = summary.run.exitCode === null ? "without an exit code" : `with exit code ${summary.run.exitCode}`;
		return [
			diagnostic(
				{
					code: "invalid_root",
					event,
					message: `Hook command failed ${status}.`,
					path: "process.exitCode",
					severity: "warning",
				},
				summary.handler.source,
			),
		];
	});
}

function preCompactUnsupportedDiagnostics(
	handler: ExecutableHookHandler,
	output: LifecycleHookOutput | undefined,
): readonly HookDiagnostic[] {
	if (output === undefined) return [];
	const diagnostics: HookDiagnostic[] = [];
	if (output.additionalContext !== undefined) {
		diagnostics.push(
			diagnostic(
				{
					code: "unsupported_field",
					event: "PreCompact",
					message: "PreCompact additionalContext is diagnostic-only in builtin hooks v1.",
					path: "stdout.hookSpecificOutput.additionalContext",
					severity: "warning",
				},
				handler.source,
			),
		);
	}
	if (output.customInstructions !== undefined) {
		diagnostics.push(
			diagnostic(
				{
					code: "unsupported_field",
					event: "PreCompact",
					message: "PreCompact customInstructions cannot mutate compaction in builtin hooks v1.",
					path: "stdout.hookSpecificOutput.customInstructions",
					severity: "warning",
				},
				handler.source,
			),
		);
	}
	return diagnostics;
}

function readLifecycleHookOutput(event: LifecycleHookEvent, stdout: string): LifecycleHookOutput | undefined {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
	if (!isRecord(parsed)) return undefined;
	const specific = isRecord(parsed.hookSpecificOutput) ? parsed.hookSpecificOutput : undefined;
	if (specific?.hookEventName !== undefined && specific.hookEventName !== event) return undefined;
	return {
		...textField(specific?.additionalContext ?? parsed.additionalContext, "additionalContext"),
		...textField(specific?.customInstructions ?? parsed.customInstructions, "customInstructions"),
		...textField(parsed.decision, "decision"),
		...textField(specific?.permissionDecisionReason ?? parsed.reason, "reason"),
	};
}

function textField<K extends keyof LifecycleHookOutput>(
	value: unknown,
	key: K,
): Pick<LifecycleHookOutput, K> | Record<string, never> {
	if (typeof value !== "string") return {};
	const trimmed = value.trim();
	return trimmed.length === 0 ? {} : ({ [key]: trimmed } as Pick<LifecycleHookOutput, K>);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
