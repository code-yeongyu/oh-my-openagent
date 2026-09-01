import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("codex PostToolUse hook CLI", () => {
	it("#given malformed post-tool-use stdin #when hook CLI runs #then it no-ops without stderr", () => {
		// given
		const input = "break;\n";

		// when
		const result = runBuiltHookCli(input);

		// then
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
	});

	it("#given a session state path that fails to read #when hook CLI runs #then it stays silent and exits zero", () => {
		// given
		const pluginData = mkdtempSync(path.join(tmpdir(), "codex-lsp-hook-cli-"));
		mkdirSync(path.join(pluginData, "sessions", "qa-session.json"), { recursive: true });
		const input = JSON.stringify({
			session_id: "qa-session",
			tool_name: "Edit",
			tool_input: { file_path: path.join(pluginData, "edited.ts") },
		});

		// when
		const result = runBuiltHookCli(input, { PLUGIN_DATA: pluginData });

		// then
		rmSync(pluginData, { recursive: true, force: true });
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
	});
});

function runBuiltHookCli(input: string, env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
	const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
	return spawnSync(process.execPath, [cliPath, "hook", "post-tool-use"], {
		input,
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}
