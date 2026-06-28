import { readFileSync } from "node:fs";
import { env } from "node:process";

const AUTO_WORKFLOW_DIRECTIVE_MARKER = "<lazycodex-auto-workflow>";
const AUTO_WORKFLOW_FLAG_NAME = "OMO_CODEX_AUTO_WORKFLOW";
const TRANSCRIPT_SEARCH_BYTES = 512_000;
const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const;
const EXPLICIT_WORKFLOW_PATTERNS = [
	/\b(?:ultrawork|ulw)\b/i,
	/(?:^|\s)\$(?:init-deep|ulw-plan|start-work|ulw-loop)\b/i,
	/\bomo\s+ulw-loop\b/i,
] as const;
const DEBUGGING_PROMPT_PATTERNS = [
	/\b(?:fix|debug|diagnose|investigate)\b[\s\S]{0,80}\b(?:bug|failure|failing|failed|flaky|regression|error|crash|ci|test|tests|build|typecheck)\b/i,
	/\b(?:bug|failure|failing|failed|flaky|regression|error|crash|ci|test|tests|build|typecheck)\b[\s\S]{0,80}\b(?:fix|debug|diagnose|investigate|why)\b/i,
	/\bwhy (?:is|are|did|does|do)\b[\s\S]{0,80}\b(?:broken|failing|failed|error|crash|regress|ci)\b/i,
] as const;
const START_WORK_PROMPT_PATTERNS = [
	/\b(?:continue|resume|execute|start|run|work)\b[\s\S]{0,80}\b(?:approved|accepted|existing|current|ready)\b[\s\S]{0,80}\b(?:plan|workplan|prometheus plan)\b/i,
	/\b(?:approved|accepted|existing|current|ready)\b[\s\S]{0,80}\b(?:plan|workplan|prometheus plan)\b[\s\S]{0,80}\b(?:continue|resume|execute|start|run|work)\b/i,
] as const;
const PLANNING_PROMPT_PATTERNS = [
	/\b(?:add|build|implement|create|ship)\b[\s\S]{0,100}\b(?:feature|page|screen|flow|integration|dashboard|service|api)\b/i,
	/\b(?:large|broad|complex|multi[- ]?file|cross[- ]?module|architecture|architectural)\b[\s\S]{0,100}\b(?:change|refactor|feature|migration|rewrite|cleanup)\b/i,
	/\b(?:refactor|restructure|redesign|modernize|migrate|rewrite)\b[\s\S]{0,100}\b(?:flow|module|system|package|architecture|codebase|auth|api)\b/i,
] as const;
const WEAK_CONTEXT_PROMPT_PATTERNS = [
	/\b(?:new|unfamiliar|large|unknown)\b[\s\S]{0,80}\b(?:repo|repository|codebase|project)\b/i,
	/\b(?:onboard|understand|map|survey)\b[\s\S]{0,80}\b(?:repo|repository|codebase|project|architecture)\b/i,
] as const;
const AUTO_WORKFLOW_CONTEXT = [
	AUTO_WORKFLOW_DIRECTIVE_MARKER,
	"LazyCodex automatic workflow selection is enabled for this turn.",
	"",
	"Selection:",
] as const;
const WORKFLOW_MATCHERS = [
	{
		name: "debugging or recovery work",
		patterns: DEBUGGING_PROMPT_PATTERNS,
		guidance: [
			"- Treat this as debugging or recovery work.",
			"- Prefer the `$ulw-loop` / `omo ulw-loop` verification loop before editing.",
			"- Preserve manual QA evidence for every claimed fix.",
		].join("\n"),
	},
	{
		name: "approved-plan continuation",
		patterns: START_WORK_PROMPT_PATTERNS,
		guidance: [
			"- Treat this as approved-plan continuation work.",
			"- Prefer `$start-work` so execution follows the existing plan instead of replanning.",
			"- Preserve the plan's acceptance criteria and evidence requirements.",
		].join("\n"),
	},
	{
		name: "weak-context repository onboarding",
		patterns: WEAK_CONTEXT_PROMPT_PATTERNS,
		guidance: [
			"- Treat this as weak-context repository onboarding.",
			"- Prefer `$init-deep` before broad implementation work.",
			"- If the repo is already mapped, continue with the existing project knowledge instead of remapping.",
		].join("\n"),
	},
	{
		name: "broad delivery work",
		patterns: PLANNING_PROMPT_PATTERNS,
		guidance: [
			"- Treat this as broad delivery work.",
			"- Prefer `$ulw-plan` before implementation, then continue with `$start-work` when the plan is ready.",
			"- If the prompt is actually a tiny edit, keep it in plain Codex instead.",
		].join("\n"),
	},
] as const;

export type CodexUserPromptSubmitInput = {
	readonly hook_event_name: "UserPromptSubmit";
	readonly prompt: string;
	readonly transcript_path?: string | null;
};

type TranscriptReader = (transcriptPath: string) => string;

type UserPromptSubmitHookRuntime = {
	readonly hookEnv?: NodeJS.ProcessEnv;
	readonly transcriptReader?: TranscriptReader;
};

interface UserPromptSubmitHookOutput {
	readonly hookSpecificOutput: {
		readonly hookEventName: "UserPromptSubmit";
		readonly additionalContext: string;
	};
}

export function runUserPromptSubmitHook(
	input: unknown,
	runtime: UserPromptSubmitHookRuntime = {},
): string {
	if (!isCodexUserPromptSubmitInput(input)) return "";
	const hookEnv = runtime.hookEnv ?? env;
	if (!isAutoWorkflowEnabled(hookEnv)) return "";
	const transcriptReader = runtime.transcriptReader ?? readTranscriptTail;
	if (isContextPressureRecoveryPrompt(input.prompt)) return "";
	if (
		hasAutoWorkflowContextAlreadyInTranscript(
			input.transcript_path,
			transcriptReader,
		)
	)
		return "";
	if (isContextPressureTranscript(input.transcript_path, transcriptReader))
		return "";
	const autoWorkflowContext = buildAutoWorkflowContext(input.prompt, hookEnv);
	return autoWorkflowContext === null
		? ""
		: formatAdditionalContextOutput(autoWorkflowContext);
}

export function buildAutoWorkflowContext(
	prompt: string,
	hookEnv: NodeJS.ProcessEnv = env,
): string | null {
	if (!isAutoWorkflowEnabled(hookEnv)) return null;
	if (matchesAny(prompt, EXPLICIT_WORKFLOW_PATTERNS)) return null;
	const selection = selectAutoWorkflow(prompt);
	if (selection === null) return null;
	return [
		...AUTO_WORKFLOW_CONTEXT,
		selection,
		"</lazycodex-auto-workflow>",
	].join("\n");
}

function isAutoWorkflowEnabled(hookEnv: NodeJS.ProcessEnv): boolean {
	const rawFlag = hookEnv[AUTO_WORKFLOW_FLAG_NAME];
	if (rawFlag === undefined) return false;
	return /^(?:1|true|yes|on)$/i.test(rawFlag);
}

function selectAutoWorkflow(prompt: string): string | null {
	const matches = WORKFLOW_MATCHERS.filter((workflow) =>
		matchesAny(prompt, workflow.patterns),
	);
	if (matches.length === 0) return null;
	if (matches.length > 1) {
		return [
			"- Several LazyCodex workflows may fit this prompt.",
			`- Ask one concise confirmation before escalating: ${matches.map((match) => match.name).join(", ")}.`,
			"- Keep the turn plain if the user confirms this is a small direct edit.",
		].join("\n");
	}
	return matches[0]?.guidance ?? null;
}

function hasAutoWorkflowContextAlreadyInTranscript(
	transcriptPath: string | null | undefined,
	transcriptReader: TranscriptReader,
): boolean {
	if (transcriptPath === undefined || transcriptPath === null) return false;
	try {
		const rawTranscript = transcriptReader(transcriptPath);
		for (const line of rawTranscript.split(/\r?\n/)) {
			const parsed = parseJsonLine(line);
			if (!isRecord(parsed)) continue;
			const hookSpecificOutput = parsed["hookSpecificOutput"];
			if (!isRecord(hookSpecificOutput)) continue;
			if (hookSpecificOutput["hookEventName"] !== "UserPromptSubmit") continue;
			if (
				typeof hookSpecificOutput["additionalContext"] === "string" &&
				hookSpecificOutput["additionalContext"].includes(
					AUTO_WORKFLOW_DIRECTIVE_MARKER,
				)
			) {
				return true;
			}
		}
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
	return false;
}

function readTranscriptTail(transcriptPath: string): string {
	const rawTranscript = readFileSync(transcriptPath);
	return rawTranscript
		.subarray(Math.max(0, rawTranscript.byteLength - TRANSCRIPT_SEARCH_BYTES))
		.toString("utf8");
}

function isContextPressureRecoveryPrompt(prompt: string): boolean {
	const normalizedPrompt = prompt.toLowerCase();
	return CONTEXT_PRESSURE_MARKERS.some((marker) =>
		normalizedPrompt.includes(marker),
	);
}

function isContextPressureTranscript(
	transcriptPath: string | null | undefined,
	transcriptReader: TranscriptReader,
): boolean {
	if (transcriptPath === undefined || transcriptPath === null) return false;
	try {
		return isContextPressureRecoveryPrompt(transcriptReader(transcriptPath));
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function formatAdditionalContextOutput(additionalContext: string): string {
	const normalizedContext = normalizeAdditionalContext(additionalContext);
	if (normalizedContext.length === 0) return "";
	const output: UserPromptSubmitHookOutput = {
		hookSpecificOutput: {
			hookEventName: "UserPromptSubmit",
			additionalContext: normalizedContext,
		},
	};
	return `${JSON.stringify(output)}\n`;
}

function normalizeAdditionalContext(additionalContext: string): string {
	return additionalContext.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function parseJsonLine(line: string): unknown | null {
	if (line.trim().length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(line);
		return parsed;
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function matchesAny(prompt: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(prompt));
}

function isCodexUserPromptSubmitInput(
	value: unknown,
): value is CodexUserPromptSubmitInput {
	return (
		isRecord(value) &&
		value["hook_event_name"] === "UserPromptSubmit" &&
		typeof value["prompt"] === "string" &&
		(value["transcript_path"] === undefined ||
			value["transcript_path"] === null ||
			typeof value["transcript_path"] === "string")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
