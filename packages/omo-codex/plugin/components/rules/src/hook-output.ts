export type ContextInjectionHookEventName = "SessionStart" | "UserPromptSubmit" | "PostToolUse";

export function formatAdditionalContextOutput(
	eventName: ContextInjectionHookEventName,
	additionalContext: string,
): string {
	const normalizedContext = normalizeAdditionalContext(additionalContext);
	if (normalizedContext.length === 0) return "";
	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: eventName,
			additionalContext: normalizedContext,
		},
	})}\n`;
}

function normalizeAdditionalContext(additionalContext: string): string {
	return additionalContext.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}
