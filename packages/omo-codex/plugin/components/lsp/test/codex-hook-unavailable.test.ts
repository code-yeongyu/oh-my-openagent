import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runLspPostCompactHook, runLspPostToolUseHook } from "../src/codex-hook.js";

const MARKSMAN_INITIALIZE_TIMEOUT = [
	"LSP request timeout (method: initialize)",
	'recent stderr: [01:16:41 INF] <LSP Entry> Starting Marksman LSP server: {"arch":"Arm64"}',
	'[01:16:41 INF] <Folder> Loading folder documents: {"uri":"file:///repo"}',
].join("\n");

const tempDirs: string[] = [];

afterEach(() => {
	for (const tempDir of tempDirs.splice(0)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("codex PostToolUse unavailable LSP suppression", () => {
	it("#given unavailable markdown LSP in one session #when PostToolUse repeats #then suppresses feedback and skips the cached extension", async () => {
		// given
		const pluginData = tempPluginData();
		const input = postToolUseInput("session-unavailable", ".omo/ulw-loop/evidence/note.md");
		let calls = 0;

		await withPluginData(pluginData, async () => {
			// when
			const firstOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return MARKSMAN_INITIALIZE_TIMEOUT;
			});
			const secondOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return "error[markdown] (1000) at 1:1: second call should have been skipped.";
			});

			// then
			expect(firstOutput).toBe("");
			expect(secondOutput).toBe("");
			expect(calls).toBe(1);
		});
	});

	it("#given cached unavailable LSP after PostCompact #when the next PostToolUse runs #then probes once and suppresses again", async () => {
		// given
		const pluginData = tempPluginData();
		const input = postToolUseInput("session-compact", ".omo/ulw-loop/evidence/note.md");
		let calls = 0;

		await withPluginData(pluginData, async () => {
			await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return MARKSMAN_INITIALIZE_TIMEOUT;
			});
			await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return "error[markdown] (1000) at 1:1: cached call should have been skipped.";
			});

			// when
			const compactInput = {
				cwd: "/repo",
				hook_event_name: "PostCompact",
				model: "gpt-5.5",
				session_id: "session-compact",
				transcript_path: null,
				trigger: "manual",
				turn_id: "turn-compact",
			};
			const compactOutput = await runLspPostCompactHook(compactInput);
			const afterCompactOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return MARKSMAN_INITIALIZE_TIMEOUT;
			});
			await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return "error[markdown] (1000) at 1:1: post-compact cached call should have been skipped.";
			});

			// then
			expect(compactOutput).toBe("");
			expect(afterCompactOutput).toBe("");
			expect(calls).toBe(2);
		});
	});

	it("#given cached unavailable LSP after PostCompact #when the probe is clean #then clears the unavailable cache", async () => {
		// given
		const pluginData = tempPluginData();
		const input = postToolUseInput("session-compact-clean", ".omo/ulw-loop/evidence/note.md");
		let calls = 0;

		await withPluginData(pluginData, async () => {
			await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return MARKSMAN_INITIALIZE_TIMEOUT;
			});
			await runLspPostCompactHook({ session_id: "session-compact-clean" });

			// when
			const cleanProbeOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return "No diagnostics found";
			});
			const laterDiagnosticOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return "error[markdown] (1000) at 1:1: recovered markdown diagnostic.";
			});

			// then
			expect(cleanProbeOutput).toBe("");
			expect(laterDiagnosticOutput).toContain("recovered markdown diagnostic");
			expect(calls).toBe(3);
		});
	});

	it("#given markdown LSP is cached unavailable #when TypeScript diagnostics run #then real diagnostics still block", async () => {
		// given
		const pluginData = tempPluginData();
		const markdownInput = postToolUseInput("session-real-diagnostics", "README.md");
		const typescriptInput = postToolUseInput("session-real-diagnostics", "src/broken.ts");

		await withPluginData(pluginData, async () => {
			await runLspPostToolUseHook(markdownInput, async () => MARKSMAN_INITIALIZE_TIMEOUT);

			// when
			const output = await runLspPostToolUseHook(
				typescriptInput,
				async () => "error[typescript] (2304) at 1:1: Cannot find name 'missing'.",
			);

			// then
			const parsed: unknown = JSON.parse(output);
			if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");
			expect(parsed.reason).toBe(
				"LSP diagnostics after editing src/broken.ts:\n\n" +
					"- error[typescript] (2304) at 1:1: Cannot find name 'missing'.",
			);
		});
	});
});

function postToolUseInput(sessionId: string, filePath: string) {
	return {
		cwd: "/repo",
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		session_id: sessionId,
		tool_input: { path: filePath },
		tool_name: "write",
		tool_response: { ok: true },
		tool_use_id: "tool-use-1",
		transcript_path: null,
		turn_id: "turn-1",
	};
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

function tempPluginData(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "codex-lsp-unavailable-"));
	tempDirs.push(dir);
	return dir;
}

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
