export type ContextInjectionHookEventName = "SessionStart" | "UserPromptSubmit" | "PostToolUse";

const MAX_ADDITIONAL_CONTEXT_CHARS = 32_000;

export function formatAdditionalContextOutput(
	eventName: ContextInjectionHookEventName,
	additionalContext: string,
): string {
	const normalizedContext = limitAdditionalContext(normalizeAdditionalContext(additionalContext));
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

function limitAdditionalContext(additionalContext: string): string {
	if (additionalContext.length <= MAX_ADDITIONAL_CONTEXT_CHARS) return additionalContext;
	const marker = `\n\n[Truncated hook additional context to ${MAX_ADDITIONAL_CONTEXT_CHARS} chars to avoid Codex context overflow.]`;
	if (marker.length >= MAX_ADDITIONAL_CONTEXT_CHARS) return marker.slice(0, MAX_ADDITIONAL_CONTEXT_CHARS);
	const head = additionalContext.slice(0, MAX_ADDITIONAL_CONTEXT_CHARS - marker.length).replace(/[ \t\r\n]+$/, "");
	return `${head}${marker}`;
}
