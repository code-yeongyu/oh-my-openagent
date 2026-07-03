import { type BuildDynamicSystemPromptOptions, buildDynamicSystemPrompt } from "../../../dynamic-prompt/build.ts";
import { buildFileOperationsTuning } from "./file-operations.ts";

function buildGpt52Tuning(): string {
	return `Constrain verbosity explicitly: "3-6 sentences", "max 5 bullets", "no preamble". Do not over-explain simple tasks.

Optimize tool usage with explicit budgets: "maximum 3 tool calls for this lookup" or "one broad search first, only search again if the core question remains unanswered."

Implement EXACTLY and ONLY what was requested. No extra features, no scope drift.

Compact after major milestones, not every turn. Keep the system prompt functionally identical when resuming.

${buildFileOperationsTuning()}`;
}

export function buildGpt52Prompt(options: BuildDynamicSystemPromptOptions): string {
	return buildDynamicSystemPrompt({ ...options, tuningSection: buildGpt52Tuning() });
}
