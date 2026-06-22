import { describe, expect, it } from "vitest";

import { runPostToolUseHook } from "../src/codex-hook.js";

describe("thread title PostToolUse guidance", () => {
	it("#given codex_app.create_thread completed #when the hook runs #then it asks Codex to immediately set a descriptive title", () => {
		// given
		const output = runPostToolUseHook({
			hook_event_name: "PostToolUse",
			session_id: "s-team",
			turn_id: "t-team",
			transcript_path: null,
			cwd: "/repo",
			model: "gpt-5.5",
			permission_mode: "default",
			tool_name: "create_thread",
			tool_use_id: "tool-create-thread",
			tool_input: {
				prompt: "Investigate package install failures",
				target: { type: "project", projectId: "/repo", environment: { type: "local" } },
			},
			tool_response: { threadId: "thread-123" },
		});

		// when
		const parsed: unknown = JSON.parse(output);

		// then
		expect(isHookOutput(parsed)).toBe(true);
		if (!isHookOutput(parsed)) return;
		expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
		expect(parsed.hookSpecificOutput.additionalContext).toBe(
			"THREAD ID thread-123: CALL codex_app.set_thread_title NOW. USE THE REAL TASK/ROLE.",
		);
	});

	it("#given an unrelated tool completed #when the hook runs #then it stays silent", () => {
		// given
		const output = runPostToolUseHook({
			hook_event_name: "PostToolUse",
			session_id: "s-team",
			turn_id: "t-team",
			transcript_path: null,
			cwd: "/repo",
			model: "gpt-5.5",
			permission_mode: "default",
			tool_name: "read_thread",
			tool_use_id: "tool-read-thread",
			tool_input: { threadId: "thread-123" },
			tool_response: { status: "ok" },
		});

		// when
		const actual = output;

		// then
		expect(actual).toBe("");
	});

	it("#given worktree-backed thread creation is pending #when the hook runs #then it tells Codex to title the thread once the thread id exists", () => {
		// given
		const output = runPostToolUseHook({
			hook_event_name: "PostToolUse",
			session_id: "s-team",
			turn_id: "t-team",
			transcript_path: null,
			cwd: "/repo",
			model: "gpt-5.5",
			permission_mode: "default",
			tool_name: "codex_app.create_thread",
			tool_use_id: "tool-create-thread",
			tool_input: {
				prompt: "Fix CodeGraph provisioned launcher skip on Node 25",
				target: {
					type: "project",
					projectId: "/repo",
					environment: { type: "worktree", startingState: { type: "working-tree" } },
				},
			},
			tool_response: {
				pendingWorktreeId: "remote-control:env:test-worktree",
			},
		});

		// when
		const parsed: unknown = JSON.parse(output);

		// then
		expect(isHookOutput(parsed)).toBe(true);
		if (!isHookOutput(parsed)) return;
		expect(parsed.hookSpecificOutput.additionalContext).toBe(
			"PENDING WORKTREE ID remote-control:env:test-worktree: CALL codex_app.set_thread_title AS SOON AS THREAD ID EXISTS. USE THE REAL TASK/ROLE.",
		);
	});
});

interface HookOutput {
	readonly hookSpecificOutput: {
		readonly hookEventName: "PostToolUse";
		readonly additionalContext: string;
	};
}

function isHookOutput(value: unknown): value is HookOutput {
	if (!isRecord(value)) return false;
	const hookSpecificOutput = value["hookSpecificOutput"];
	return (
		isRecord(hookSpecificOutput) &&
		hookSpecificOutput["hookEventName"] === "PostToolUse" &&
		typeof hookSpecificOutput["additionalContext"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
