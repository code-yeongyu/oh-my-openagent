import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { PostEditDiagnosticsOutcome } from "@oh-my-opencode/lsp-core/post-edit";

import { runLspPostCompactHook, runLspPostToolUseHook } from "../src/codex-hook.js";

const DAEMON_UNREACHABLE = [
	"LSP daemon unreachable: daemon did not become reachable.",
	"The MCP server is a thin proxy and never runs language servers in-process.",
	"Logs: /tmp/daemon.log",
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
				return markdownNotConfigured();
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
				return markdownNotConfigured();
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
				return markdownNotConfigured();
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
				return markdownNotConfigured();
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

	it("#given the LSP daemon is unreachable #when PostToolUse repeats #then it suppresses feedback once and retries on the next edit", async () => {
		// given
		const pluginData = tempPluginData();
		const input = postToolUseInput("session-daemon-down", "src/app.ts");
		let calls = 0;

		await withPluginData(pluginData, async () => {
			// when
			const firstOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return DAEMON_UNREACHABLE;
			});
			const secondOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return "error[typescript] (2304) at 1:1: Cannot find name 'missing'.";
			});

			// then
			expect(firstOutput).toBe("");
			expect(secondOutput).toContain("Cannot find name 'missing'");
			expect(calls).toBe(2);
		});
	});

	it("#given a cached unavailable extension #when the post-compact probe hits a daemon outage #then the cache survives and the probe stays pending", async () => {
		// given
		const pluginData = tempPluginData();
		const input = postToolUseInput("session-daemon-down-probe", ".omo/ulw-loop/evidence/note.md");
		let calls = 0;

			await withPluginData(pluginData, async () => {
				await runLspPostToolUseHook(input, async () => {
					calls += 1;
					return markdownNotConfigured();
				});
			await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return "error[markdown] (1000) at 1:1: cached call should have been skipped.";
			});
			await runLspPostCompactHook({ session_id: "session-daemon-down-probe" });

			// when
			const outageProbeOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return DAEMON_UNREACHABLE;
			});
			const retriedProbeOutput = await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return markdownNotConfigured();
			});
			await runLspPostToolUseHook(input, async () => {
				calls += 1;
				return "error[markdown] (1000) at 1:1: re-cached call should have been skipped.";
			});

			// then
			expect(outageProbeOutput).toBe("");
			expect(retriedProbeOutput).toBe("");
			expect(calls).toBe(3);
		});
	});

	it("#given markdown LSP is cached unavailable #when TypeScript diagnostics run #then real diagnostics still block", async () => {
		// given
		const pluginData = tempPluginData();
		const markdownInput = postToolUseInput("session-real-diagnostics", "README.md");
		const typescriptInput = postToolUseInput("session-real-diagnostics", "src/broken.ts");

		await withPluginData(pluginData, async () => {
			await runLspPostToolUseHook(markdownInput, async () => markdownNotConfigured());

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

function markdownNotConfigured(): PostEditDiagnosticsOutcome {
	return { kind: "not_configured", extension: ".md" };
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
