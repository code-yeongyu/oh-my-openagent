import { readFileSync } from "node:fs";

export const LAZYCODEX_EXECUTOR_VERIFY_DIRECTIVE: string = readFileSync(
	new URL("../directive.md", import.meta.url),
	"utf8",
);

export function renderDirective(attempts: number, lastAssistantMessage: string | undefined): string {
	return LAZYCODEX_EXECUTOR_VERIFY_DIRECTIVE.replaceAll("{{ATTEMPT_COUNT}}", String(attempts)).replaceAll(
		"{{LAST_ASSISTANT_MESSAGE}}",
		lastAssistantMessage ?? "(last_assistant_message was omitted)",
	);
}
