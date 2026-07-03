import { type BuildDynamicSystemPromptOptions, buildDynamicSystemPrompt } from "../../../dynamic-prompt/build.ts";

function buildKimiK26Tuning(): string {
	return `Avoid restating the user's request, do not re-derive facts you already established this turn, and skip filler verification language ("let me confirm again", "to be sure", "just to double-check").

The intent gate routing line is required every turn. On confirmation turns where the user already chose an option in plain words, acknowledge that choice and execute, not re-litigate alternatives the user already eliminated.`;
}

export function buildKimiK26Prompt(options: BuildDynamicSystemPromptOptions): string {
	return buildDynamicSystemPrompt({ ...options, tuningSection: buildKimiK26Tuning() });
}
