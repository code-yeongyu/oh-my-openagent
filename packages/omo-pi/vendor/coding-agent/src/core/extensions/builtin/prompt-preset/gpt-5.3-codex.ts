import { type BuildDynamicSystemPromptOptions, buildDynamicSystemPrompt } from "../../../dynamic-prompt/build.ts";
import { buildFileOperationsTuning } from "./file-operations.ts";

function buildGpt53CodexTuning(): string {
	return `Bias hard toward action. Implement directly with reasonable assumptions rather than stopping to ask. Do not produce upfront plans or preambles before acting — start working immediately.

Do not re-state the goal between steps. When a milestone completes, move to the next without summarizing unless the user asked for a summary.

After compaction, continue from the current state rather than re-deriving prior conclusions. Treat compacted items as opaque.

${buildFileOperationsTuning()}`;
}

export function buildGpt53CodexPrompt(options: BuildDynamicSystemPromptOptions): string {
	return buildDynamicSystemPrompt({ ...options, tuningSection: buildGpt53CodexTuning() });
}
