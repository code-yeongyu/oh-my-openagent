import { type BuildDynamicSystemPromptOptions, buildDynamicSystemPrompt } from "../../../dynamic-prompt/build.ts";
import { buildFileOperationsTuning } from "./file-operations.ts";

function buildGpt5Tuning(): string {
	return `Focus on what "done" looks like rather than chaining intermediate confirmations when the goal is already concrete. Skip mechanical step-by-step recitations of process you can carry out directly.

Retrieval budget: ordinary lookups should fit in one broad search wave. Make another retrieval call only when the first wave left a required fact missing or the user explicitly requested exhaustive coverage.

${buildFileOperationsTuning()}`;
}

export function buildGpt5Prompt(options: BuildDynamicSystemPromptOptions): string {
	return buildDynamicSystemPrompt({ ...options, tuningSection: buildGpt5Tuning() });
}
