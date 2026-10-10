import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isRequestCwdRejectionDiagnostics, runLspPostToolUseHook } from "../src/codex-hook.js";

const REQUEST_CWD_REJECTION = "LSP file path must be inside request cwd: /repo-worktrees/task-1/docs/example.md";

const tempDirs: string[] = [];

afterEach(() => {
	for (const tempDir of tempDirs.splice(0)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("codex PostToolUse hook outside request cwd", () => {
	it("#given a request-cwd containment rejection #when the hook evaluates diagnostics #then it stays silent instead of blocking the edit", async () => {
		// given
		const output = await runLspPostToolUseHook(
			{
				tool_name: "write",
				tool_input: { path: "/repo-worktrees/task-1/docs/example.md" },
				tool_response: { ok: true },
			},
			async () => REQUEST_CWD_REJECTION,
		);

		// when
		const parsed: unknown = output.length === 0 ? undefined : JSON.parse(output);

		// then
		expect(parsed).toBeUndefined();
		expect(output).toBe("");
	});

	it("#given one real error and one containment rejection #when the hook evaluates both files #then only the real diagnostic blocks", async () => {
		// given
		const output = await runLspPostToolUseHook(
			{
				tool_name: "MultiEdit",
				tool_input: {
					file_paths: ["/repo-worktrees/task-1/docs/example.md", "src/broken.ts"],
				},
				tool_response: { ok: true },
			},
			async (filePath) =>
				filePath.startsWith("/repo-worktrees/")
					? REQUEST_CWD_REJECTION
					: "error[typescript] (2304) at 1:1: Cannot find name 'missing'.",
		);

		// when
		const parsed: unknown = JSON.parse(output);
		if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");

		// then
		expect(parsed.reason).toBe(
			"LSP diagnostics after editing src/broken.ts:\n\n" +
				"- error[typescript] (2304) at 1:1: Cannot find name 'missing'.",
		);
		expect(parsed.reason).not.toContain("must be inside request cwd");
	});

	it("#given a session-scoped containment rejection #when the next edit produces real diagnostics #then the rejection is not cached and diagnostics still block", async () => {
		// given
		const input = {
			session_id: "session-outcwd-no-cache",
			tool_name: "write",
			tool_input: { path: "/repo-worktrees/task-1/docs/example.md" },
			tool_response: { ok: true },
		};
		await withPluginData(tempPluginData(), async () => {
			const rejectedOutput = await runLspPostToolUseHook(input, async () => REQUEST_CWD_REJECTION);
			expect(rejectedOutput).toBe("");

			// when
			const laterOutput = await runLspPostToolUseHook(input, async () => {
				throw new Error("diagnostics must still run after a scope-mismatch rejection");
			});

			// then
			const parsed: unknown = JSON.parse(laterOutput);
			if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");
			expect(parsed.reason).toContain("scope-mismatch rejection");
		});
	});

	it("#given unrelated error text that merely mentions the cwd #when the hook evaluates diagnostics #then it still blocks", async () => {
		// given
		const output = await runLspPostToolUseHook(
			{
				tool_name: "write",
				tool_input: { path: "src/broken.ts" },
				tool_response: { ok: true },
			},
			async () => "error[typescript] (2307) at 1:1: Cannot find module relative to cwd.",
		);

		// when
		const parsed: unknown = JSON.parse(output);
		if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");

		// then
		expect(parsed.decision).toBe("block");
	});

	it("#given the exact LSP core rejection message shapes #when classifying #then only the containment rejection matches", () => {
		// given
		const siblingWorktreeRejection =
			"LSP file path must be inside request cwd: /Users/ivk/Documents/krafton-ax/llm-gateway-worktrees/p15-codex-cli-e2e/docs/gateway-proxy/cli-compatibility-current-state.md";
		const leadingWhitespaceRejection = `  ${REQUEST_CWD_REJECTION}`;

		// when + then
		expect(isRequestCwdRejectionDiagnostics(siblingWorktreeRejection)).toBe(true);
		expect(isRequestCwdRejectionDiagnostics(leadingWhitespaceRejection)).toBe(true);
		expect(isRequestCwdRejectionDiagnostics("No diagnostics found")).toBe(false);
		expect(isRequestCwdRejectionDiagnostics("LSP daemon unreachable: daemon did not become reachable.")).toBe(false);
		expect(isRequestCwdRejectionDiagnostics("")).toBe(false);
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

function tempPluginData(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "codex-lsp-outcwd-"));
	tempDirs.push(dir);
	return dir;
}

async function withPluginData(pluginData: string, fn: () => Promise<void>): Promise<void> {
	const previous = process.env["PLUGIN_DATA"];
	process.env["PLUGIN_DATA"] = pluginData;
	try {
		await fn();
	} finally {
		if (previous === undefined) {
			delete process.env["PLUGIN_DATA"];
		} else {
			process.env["PLUGIN_DATA"] = previous;
		}
	}
}
