import { readFileSync } from "node:fs";

import { ULTRAWORK_DIRECTIVE } from "./directive.js";

const ULTRAWORK_PATTERN = /\b(?:ultrawork|ulw)\b/i;
const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const;

export type CodexUserPromptSubmitInput = {
	readonly hook_event_name: "UserPromptSubmit";
	readonly prompt: string;
	readonly transcript_path?: string | null;
};

interface UserPromptSubmitHookOutput {
	readonly hookSpecificOutput: {
		readonly hookEventName: "UserPromptSubmit";
		readonly additionalContext: string;
	};
}

export function runUserPromptSubmitHook(input: unknown): string {
	if (!isCodexUserPromptSubmitInput(input)) return "";
	if (isContextPressureRecoveryPrompt(input.prompt)) return "";
	if (isContextPressureTranscript(input.transcript_path)) return "";
	return isUltraworkPrompt(input.prompt) ? formatAdditionalContextOutput(ULTRAWORK_DIRECTIVE) : "";
}

export function isUltraworkPrompt(prompt: string): boolean {
	return ULTRAWORK_PATTERN.test(prompt);
}

function isContextPressureRecoveryPrompt(prompt: string): boolean {
	const normalizedPrompt = prompt.toLowerCase();
	return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedPrompt.includes(marker));
}

function isContextPressureTranscript(transcriptPath: string | null | undefined): boolean {
	if (transcriptPath === undefined || transcriptPath === null) return false;
	try {
		return isContextPressureRecoveryPrompt(readFileSync(transcriptPath, "utf8"));
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

function isCodexUserPromptSubmitInput(value: unknown): value is CodexUserPromptSubmitInput {
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
