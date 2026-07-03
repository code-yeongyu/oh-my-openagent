import { type BuildDynamicSystemPromptOptions, buildDynamicSystemPrompt } from "../../../dynamic-prompt/build.ts";

function buildClaudeOpus48Tuning(): string {
	return `Apply instructions at the scope the user evidently intends: "every", "all", and "each" mean the full set rather than the first item, and a fix that plainly recurs covers every occurrence. State the scope you applied.

Prefer tool calls over reasoning when a tool can resolve the question directly; do not reason past a fact you can look up. After a user turn, reason over what changed; do not re-derive facts already established in the conversation.

For frontend design with no specified visual direction, derive one from the project's context or propose distinct options before building; do not fall back to your default cream/serif/terracotta house style or generic AI aesthetics.

Do not wrap up early because the context window is running low; the harness auto-compacts context. Keep working until the task is complete.`;
}

export function buildClaudeOpus48Prompt(options: BuildDynamicSystemPromptOptions): string {
	return buildDynamicSystemPrompt({ ...options, tuningSection: buildClaudeOpus48Tuning() });
}
