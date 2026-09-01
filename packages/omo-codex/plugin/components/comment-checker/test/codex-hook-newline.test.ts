import { describe, expect, it } from "vitest";

import { type CodexPostToolUseInput, runCommentCheckerPostToolUse } from "../src/codex-hook.ts";

function postToolUseInput(): CodexPostToolUseInput {
	return {
		session_id: "thread-1",
		turn_id: "turn-1",
		transcript_path: null,
		cwd: "/repo",
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "never",
		tool_name: "apply_patch",
		tool_input: {
			command: [
				"*** Begin Patch",
				"*** Update File: src/example.ts",
				"@@",
				"-const value = 1;",
				"+// explains value",
				"+const value = 2;",
				"*** End Patch",
			].join("\n"),
		},
		tool_response: "Success. Updated files.",
		tool_use_id: "call-1",
	};
}

describe("comment-checker hook newline rendering", () => {
	it("#given checker warning with CRLF and bare CR #when hook runs #then returns normalized blocking feedback JSON", async () => {
		// given
		const output = await runCommentCheckerPostToolUse(postToolUseInput(), {
			run: async () => ({
				status: "warning",
				message: "\r\nfirst warning line\r\n  indented detail\rthird warning line\r\n",
			}),
		});

		// when
		const parsed: unknown = JSON.parse(output);

		// then
		expect(parsed).toEqual({
			decision: "block",
			reason:
				"comment-checker found issues in src/example.ts:\nfirst warning line\n  indented detail\nthird warning line",
		});
		expect(output).not.toContain("\r");
	});
});
