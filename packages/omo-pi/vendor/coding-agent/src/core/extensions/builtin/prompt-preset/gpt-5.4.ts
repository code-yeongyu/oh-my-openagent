import { type BuildDynamicSystemPromptOptions, buildDynamicSystemPrompt } from "../../../dynamic-prompt/build.ts";
import { buildFileOperationsTuning } from "./file-operations.ts";

function buildGpt54Tuning(): string {
	return `Use explicit section structure and step sequences for multi-step tasks — ordered steps with dependencies. When a specific response shape is needed, declare exact fields and order upfront, no extra text.

Default to medium reasoning effort. Escalate to high only for multi-constraint optimization, subtle bugs, or novel architecture decisions. Use low for classification, extraction, formatting.

State when each tool should and should not be called. Specify parallel vs sequential tool use.

${buildFileOperationsTuning()}`;
}

export function buildGpt54Prompt(options: BuildDynamicSystemPromptOptions): string {
	return buildDynamicSystemPrompt({ ...options, tuningSection: buildGpt54Tuning() });
}
