import type { CodeBuddyHookEventName, HookOutput, HookSpecificOutput } from "./types.ts";

/** CodeBuddy truncates oversized hook output; keep injected context well under it. */
export const MAX_ADDITIONAL_CONTEXT_CHARS = 12_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one JSON line/object; returns null instead of throwing on bad input. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * CodeBuddy hook payloads are a single JSON object on stdin. A malformed or
 * empty payload means "no opinion" — the hook must exit 0 silently rather than
 * break the tool call it observes.
 */
export async function readStdinPayload(
	stdin: NodeJS.ReadableStream,
): Promise<Record<string, unknown> | null> {
	let raw = "";
	try {
		stdin.setEncoding("utf-8");
		for await (const chunk of stdin) {
			raw += typeof chunk === "string" ? chunk : String(chunk);
		}
	} catch {
		return null;
	}
	return parseJsonObject(raw);
}

export function normalizeHookText(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function limitHookText(text: string, maxChars: number = MAX_ADDITIONAL_CONTEXT_CHARS): string {
	if (text.length <= maxChars) return text;
	const marker = `\n\n[Truncated omo hook output to ${maxChars} chars.]`;
	if (marker.length >= maxChars) return marker.slice(0, maxChars);
	const head = text.slice(0, maxChars - marker.length).replace(/[ \t\r\n]+$/, "");
	return `${head}${marker}`;
}

/** `hookSpecificOutput.additionalContext` — the context-injection channel. */
export function additionalContextOutput(
	hookEventName: CodeBuddyHookEventName,
	additionalContext: string,
): string {
	const normalized = normalizeHookText(additionalContext);
	if (normalized.length === 0) return "";

	const hookSpecificOutput: HookSpecificOutput = {
		hookEventName,
		additionalContext: limitHookText(normalized),
	};
	return serialize({ hookSpecificOutput });
}

/**
 * Block the stop / the prompt. CodeBuddy reads `continue: false` + `reason`;
 * the legacy `decision: "block"` field is deprecated upstream.
 */
export function blockOutput(hookEventName: CodeBuddyHookEventName, reason: string): string {
	const normalized = normalizeHookText(reason);
	if (normalized.length === 0) return "";
	void hookEventName;
	return serialize({ continue: false, reason: limitHookText(normalized) });
}

export function systemMessageOutput(message: string): string {
	const normalized = normalizeHookText(message);
	if (normalized.length === 0) return "";
	return serialize({ systemMessage: limitHookText(normalized) });
}

export function serialize(output: HookOutput): string {
	return `${JSON.stringify(output)}\n`;
}
