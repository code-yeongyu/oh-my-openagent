import { type BuildDynamicSystemPromptOptions, buildDynamicSystemPrompt } from "../../../dynamic-prompt/build.ts";

function buildClaudeOpus45Tuning(): string {
	return `Break complex tasks into ordered steps with clear dependencies before executing. When a request covers a set of items, apply it to every item rather than only the first, and state the scope you applied.

Do not wrap up early because the context window is running low; the harness auto-compacts context. Keep working until the task is complete.`;
}

export function buildClaudeOpus45Prompt(options: BuildDynamicSystemPromptOptions): string {
	return buildDynamicSystemPrompt({ ...options, tuningSection: buildClaudeOpus45Tuning() });
}
