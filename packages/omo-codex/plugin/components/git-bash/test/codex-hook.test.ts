import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import {
	applyGitBashPostCompactReset,
	applyGitBashPreToolUseReminder,
	runGitBashHookCli,
	type PostCompactPayload,
	type PreToolUsePayload,
} from "../src/codex-hook.js";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function preToolPayload(toolName: string, sessionId = "session-1"): PreToolUsePayload {
	return {
		cwd: "/repo",
		hook_event_name: "PreToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		session_id: sessionId,
		tool_input: { command: "pwd" },
		tool_name: toolName,
		tool_use_id: "call-1",
		transcript_path: null,
		turn_id: "turn-1",
	};
}

function postCompactPayload(sessionId = "session-1"): PostCompactPayload {
	return {
		hook_event_name: "PostCompact",
		session_id: sessionId,
		transcript_path: null,
		trigger: "manual",
	};
}

function windowsEnv(): NodeJS.ProcessEnv {
	return { OS: "Windows_NT", ComSpec: "C:\\Windows\\System32\\cmd.exe" };
}

function captureStdout(): { readonly stdout: Writable; readonly read: () => string } {
	let captured = "";
	const stdout = new Writable({
		write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
			captured += chunk instanceof Buffer ? chunk.toString() : String(chunk);
			callback();
		},
	});
	return { stdout, read: () => captured };
}

describe("applyGitBashPreToolUseReminder", () => {
	it("#given first Windows Bash call #when hook runs #then emits non-blocking git_bash guidance", () => {
		// given
		const pluginDataRoot = createTemporaryDirectory("omo-git-bash-hook-");

		// when
		const output = applyGitBashPreToolUseReminder(preToolPayload("Bash"), {
			env: windowsEnv(),
			platform: "linux",
			pluginDataRoot,
		});

		// then
		const parsed = JSON.parse(output);
		expect(parsed.hookSpecificOutput).toEqual({
			hookEventName: "PreToolUse",
			additionalContext:
				"On Windows, prefer the OMO git_bash MCP for shell commands before using built-in exec_command. Use exec_command only when git_bash is unavailable or for non-shell operations.",
		});
	});

	it("#given second Windows Bash call in same session #when hook runs #then it stays silent", () => {
		// given
		const pluginDataRoot = createTemporaryDirectory("omo-git-bash-hook-");
		const payload = preToolPayload("Bash");

		// when
		const first = applyGitBashPreToolUseReminder(payload, { env: windowsEnv(), platform: "linux", pluginDataRoot });
		const second = applyGitBashPreToolUseReminder(payload, { env: windowsEnv(), platform: "linux", pluginDataRoot });

		// then
		expect(first).toContain("git_bash");
		expect(second).toBe("");
	});

	it("#given non-Windows Bash call #when hook runs #then it stays silent", () => {
		// given
		const pluginDataRoot = createTemporaryDirectory("omo-git-bash-hook-");

		// when
		const output = applyGitBashPreToolUseReminder(preToolPayload("Bash"), {
			env: {},
			platform: "darwin",
			pluginDataRoot,
		});

		// then
		expect(output).toBe("");
	});

	it("#given non-Bash tool call #when hook runs #then it stays silent", () => {
		// given
		const pluginDataRoot = createTemporaryDirectory("omo-git-bash-hook-");

		// when
		const output = applyGitBashPreToolUseReminder(preToolPayload("exec_command"), {
			env: windowsEnv(),
			platform: "linux",
			pluginDataRoot,
		});

		// then
		expect(output).toBe("");
	});
});

describe("applyGitBashPostCompactReset", () => {
	it("#given reminder already emitted #when PostCompact runs #then next Windows Bash call emits reminder again", () => {
		// given
		const pluginDataRoot = createTemporaryDirectory("omo-git-bash-hook-");
		const payload = preToolPayload("Bash");
		const first = applyGitBashPreToolUseReminder(payload, { env: windowsEnv(), platform: "linux", pluginDataRoot });
		const second = applyGitBashPreToolUseReminder(payload, { env: windowsEnv(), platform: "linux", pluginDataRoot });

		// when
		applyGitBashPostCompactReset(postCompactPayload(), { pluginDataRoot });
		const afterCompact = applyGitBashPreToolUseReminder(payload, {
			env: windowsEnv(),
			platform: "linux",
			pluginDataRoot,
		});

		// then
		expect(first).toContain("git_bash");
		expect(second).toBe("");
		expect(afterCompact).toContain("git_bash");
	});
});

describe("runGitBashHookCli", () => {
	it("#given Codex PreToolUse stdin on Windows #when CLI hook runs #then it writes reminder JSON", async () => {
		// given
		const pluginDataRoot = createTemporaryDirectory("omo-git-bash-hook-");
		const stdin = Readable.from([JSON.stringify(preToolPayload("Bash"))]);
		const capture = captureStdout();

		// when
		await runGitBashHookCli(stdin, capture.stdout, "pre-tool-use", {
			env: windowsEnv(),
			platform: "linux",
			pluginDataRoot,
		});

		// then
		expect(capture.read()).toContain("git_bash MCP");
	});

	it("#given PostCompact stdin #when CLI hook runs #then it resets the one-shot reminder", async () => {
		// given
		const pluginDataRoot = createTemporaryDirectory("omo-git-bash-hook-");
		const payload = preToolPayload("Bash");
		applyGitBashPreToolUseReminder(payload, { env: windowsEnv(), platform: "linux", pluginDataRoot });
		const resetStdin = Readable.from([JSON.stringify(postCompactPayload())]);
		const capture = captureStdout();

		// when
		await runGitBashHookCli(resetStdin, capture.stdout, "post-compact", { pluginDataRoot });
		const afterCompact = applyGitBashPreToolUseReminder(payload, {
			env: windowsEnv(),
			platform: "linux",
			pluginDataRoot,
		});

		// then
		expect(capture.read()).toBe("");
		expect(afterCompact).toContain("git_bash");
	});
});
