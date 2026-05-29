export type ContextInjectionHookEventName = "SessionStart" | "UserPromptSubmit" | "PostToolUse";

export function formatAdditionalContextOutput(
	eventName: ContextInjectionHookEventName,
	additionalContext: string,
): string {
	if (additionalContext.trim().length === 0) return "";
	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: eventName,
			additionalContext,
		},
	})}\n`;
}
