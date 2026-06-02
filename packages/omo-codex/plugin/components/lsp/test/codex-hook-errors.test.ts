import { describe, expect, it } from "vitest";

import { runLspPostToolUseHook } from "../src/codex-hook.js";

describe("codex PostToolUse diagnostics errors", () => {
	it("#given diagnostics runner throws for a mutated file #when the hook evaluates diagnostics #then it returns blocked output with the thrown message", async () => {
		// given
		const output = await runLspPostToolUseHook(
			{
				tool_name: "write",
				tool_input: { path: "src/missing.ts" },
				tool_response: { ok: true },
			},
			async (filePath) => {
				expect(filePath).toBe("src/missing.ts");
				throw new Error("ENOENT: no such file or directory, open 'src/missing.ts'");
			},
		);

		// when
		const parsed: unknown = JSON.parse(output);
		if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");

		// then
		expect(parsed.reason).toBe(
			"LSP diagnostics after editing src/missing.ts:\n\nENOENT: no such file or directory, open 'src/missing.ts'",
		);
		expect(parsed.hookSpecificOutput.additionalContext).toBe(parsed.reason);
	});
});

interface PostToolUseHookOutput {
	readonly decision: "block";
	readonly reason: string;
	readonly hookSpecificOutput: {
		readonly hookEventName: "PostToolUse";
		readonly additionalContext: string;
	};
}

function isPostToolUseHookOutput(value: unknown): value is PostToolUseHookOutput {
	if (!isRecord(value)) return false;
	const hookSpecificOutput = value["hookSpecificOutput"];
	return (
		value["decision"] === "block" &&
		typeof value["reason"] === "string" &&
		isRecord(hookSpecificOutput) &&
		hookSpecificOutput["hookEventName"] === "PostToolUse" &&
		typeof hookSpecificOutput["additionalContext"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
