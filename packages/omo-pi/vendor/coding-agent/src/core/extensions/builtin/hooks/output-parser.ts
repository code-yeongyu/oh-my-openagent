import { diagnostic } from "./diagnostics.ts";
import type { HookDiagnostic, HookSourceMetadata, SupportedHookEvent } from "./types.ts";

export type HookOutputParseInput = {
	readonly event: SupportedHookEvent;
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly source: HookSourceMetadata;
};

type HookDecision = "allow" | "approve" | "ask" | "block" | "deny";
type MutableHookOutput = {
	decision?: HookDecision;
	reason?: string;
	additionalContext?: string;
	updatedInput?: unknown;
	updatedToolOutput?: unknown;
	continue?: boolean;
	stopReason?: string;
	suppressOutput?: boolean;
	systemMessage?: string;
};

export type ParsedHookOutput = {
	readonly output: Readonly<MutableHookOutput>;
	readonly diagnostics: readonly HookDiagnostic[];
};

type ParseState = {
	readonly input: HookOutputParseInput;
	readonly output: MutableHookOutput;
	readonly diagnostics: HookDiagnostic[];
};

const SYSTEM_MESSAGE_EVENTS = new Set<SupportedHookEvent>([
	"PreToolUse",
	"PostToolUse",
	"UserPromptSubmit",
	"SessionStart",
	"Stop",
]);

export function parseHookOutput(input: HookOutputParseInput): ParsedHookOutput {
	const state: ParseState = { input, output: {}, diagnostics: [] };
	const stderr = text(input.stderr);
	if (input.exitCode === 2) {
		return { output: { decision: "block", ...(stderr === undefined ? {} : { reason: stderr }) }, diagnostics: [] };
	}
	const stdout = input.stdout.trim();
	if (stdout.length === 0) return parsedOutput(state);
	const parsed = parseStdoutJson(stdout, state);
	if (!isRecord(parsed)) return parsedOutput(state);
	parseUniversal(parsed, state);
	const specific = parseSpecific(parsed.hookSpecificOutput, state);
	if (specific === "mismatched" || specific === "invalid") return parsedOutput(state);
	parseEvent(parsed, specific, state);
	return parsedOutput(state);
}

function parseStdoutJson(stdout: string, state: ParseState): unknown {
	try {
		const parsed: unknown = JSON.parse(stdout);
		if (isRecord(parsed)) return parsed;
		add(state, "invalid_root", "stdout", "Hook stdout JSON must be an object.");
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		add(state, "invalid_root", "stdout", "Hook stdout must be valid JSON.");
	}
	return undefined;
}

function parseUniversal(parsed: Record<string, unknown>, state: ParseState): void {
	if (typeof parsed.continue === "boolean") {
		state.output.continue = parsed.continue;
		if (state.input.event === "Stop" && parsed.continue === false) state.output.decision = "block";
	}
	copyText(parsed.stopReason, "stopReason", state);
	if (typeof parsed.suppressOutput === "boolean") state.output.suppressOutput = parsed.suppressOutput;
	if (parsed.systemMessage === undefined) return;
	if (SYSTEM_MESSAGE_EVENTS.has(state.input.event)) {
		copyText(parsed.systemMessage, "systemMessage", state);
		return;
	}
	add(
		state,
		"unsupported_field",
		"stdout.systemMessage",
		"Hook systemMessage is not supported for this event.",
		"warning",
	);
}

function parseSpecific(
	value: unknown,
	state: ParseState,
): Record<string, unknown> | "invalid" | "mismatched" | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		add(
			state,
			"invalid_event_config",
			"stdout.hookSpecificOutput",
			"Hook hookSpecificOutput field must be an object.",
		);
		return "invalid";
	}
	const eventName = value.hookEventName;
	if (eventName === undefined || eventName === state.input.event) return value;
	add(
		state,
		"invalid_event_config",
		"stdout.hookSpecificOutput.hookEventName",
		`Hook output event ${String(eventName)} does not match ${state.input.event}.`,
	);
	return "mismatched";
}

function parseEvent(
	parsed: Record<string, unknown>,
	specific: Record<string, unknown> | undefined,
	state: ParseState,
): void {
	switch (state.input.event) {
		case "PreToolUse":
			parsePreToolUse(parsed, specific, state);
			return;
		case "PostToolUse":
			blockOnlyDecision(parsed.decision, "PostToolUse", state);
			copyText(parsed.reason, "reason", state);
			copyText(specific?.additionalContext ?? parsed.additionalContext, "additionalContext", state);
			copyUnknown(specific?.updatedToolOutput ?? parsed.updatedToolOutput, "updatedToolOutput", state);
			return;
		case "UserPromptSubmit":
			blockOnlyDecision(parsed.decision, "UserPromptSubmit", state);
			copyText(parsed.reason, "reason", state);
			copyText(specific?.additionalContext ?? parsed.additionalContext, "additionalContext", state);
			rejectPromptReplacement(specific, state);
			return;
		case "Stop":
			if (parsed.decision === "block") state.output.decision = "block";
			else if (parsed.decision !== undefined && parsed.decision !== "continue") {
				add(
					state,
					"unsupported_field",
					"stdout.decision",
					"Stop only supports decision block or continue.",
					"warning",
				);
			}
			copyText(parsed.reason, "reason", state);
			copyText(specific?.additionalContext ?? parsed.additionalContext, "additionalContext", state);
			return;
		case "SessionStart":
			copyText(specific?.additionalContext ?? parsed.additionalContext, "additionalContext", state);
			if (parsed.decision !== undefined) {
				add(state, "unsupported_field", "stdout.decision", "SessionStart does not support decisions.", "warning");
			}
			return;
		case "PreCompact":
		case "PostCompact":
			return;
	}
}

function parsePreToolUse(
	parsed: Record<string, unknown>,
	specific: Record<string, unknown> | undefined,
	state: ParseState,
): void {
	const decision = preToolUseDecision(specific?.permissionDecision ?? parsed.decision);
	if (decision !== undefined) state.output.decision = decision;
	copyText(specific?.permissionDecisionReason ?? parsed.reason, "reason", state);
	copyText(specific?.additionalContext ?? parsed.additionalContext, "additionalContext", state);
	const updatedInput = specific?.updatedInput ?? parsed.updatedInput;
	if (updatedInput === undefined) return;
	if (specific?.permissionDecision === "allow") {
		state.output.updatedInput = updatedInput;
		return;
	}
	add(
		state,
		"unsupported_field",
		"stdout.hookSpecificOutput.updatedInput",
		"PreToolUse updatedInput is only applied when permissionDecision is allow.",
		"warning",
	);
}

function blockOnlyDecision(value: unknown, event: string, state: ParseState): void {
	if (value === "block") state.output.decision = "block";
	else if (value !== undefined)
		add(state, "unsupported_field", "stdout.decision", `${event} only supports decision block.`, "warning");
}

function rejectPromptReplacement(specific: Record<string, unknown> | undefined, state: ParseState): void {
	for (const field of ["prompt", "updatedPrompt", "replacementPrompt"]) {
		if (specific !== undefined && Object.hasOwn(specific, field)) {
			add(
				state,
				"unsupported_field",
				`stdout.hookSpecificOutput.${field}`,
				"UserPromptSubmit prompt replacement is not supported.",
				"warning",
			);
		}
	}
}

function preToolUseDecision(value: unknown): HookDecision | undefined {
	if (value === "allow" || value === "approve" || value === "ask") return value;
	if (value === "deny" || value === "block") return "deny";
	return undefined;
}

function copyText(
	value: unknown,
	field: "additionalContext" | "reason" | "stopReason" | "systemMessage",
	state: ParseState,
): void {
	const normalized = text(value);
	if (normalized !== undefined) state.output[field] = normalized;
}

function copyUnknown(value: unknown, field: "updatedToolOutput", state: ParseState): void {
	if (value !== undefined) state.output[field] = value;
}

function add(
	state: ParseState,
	code: "invalid_event_config" | "invalid_root" | "unsupported_field",
	path: string,
	message: string,
	severity?: "error" | "warning",
): void {
	state.diagnostics.push(
		diagnostic(
			{ code, event: state.input.event, message, path, ...(severity === undefined ? {} : { severity }) },
			state.input.source,
		),
	);
}

function text(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsedOutput(state: ParseState): ParsedHookOutput {
	return { output: state.output, diagnostics: state.diagnostics };
}
