import { ULTRAWORK_DIRECTIVE } from "./directive.js";

const ULTRAWORK_PATTERN = /\b(?:ultrawork|ulw)\b/i;

export type CodexUserPromptSubmitInput = {
	readonly hook_event_name: "UserPromptSubmit";
	readonly prompt: string;
};

export function runUserPromptSubmitHook(input: unknown): string {
	if (!isCodexUserPromptSubmitInput(input)) return "";
	return isUltraworkPrompt(input.prompt) ? ULTRAWORK_DIRECTIVE : "";
}

export function isUltraworkPrompt(prompt: string): boolean {
	return ULTRAWORK_PATTERN.test(prompt);
}

function isCodexUserPromptSubmitInput(value: unknown): value is CodexUserPromptSubmitInput {
	return isRecord(value) && value["hook_event_name"] === "UserPromptSubmit" && typeof value["prompt"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
