import { spawnSync } from "node:child_process";
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
});

function runBuiltHookCli(input: string): ReturnType<typeof spawnSync> {
	const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
	return spawnSync(process.execPath, [cliPath, "hook", "post-tool-use"], {
		input,
		encoding: "utf8",
	});
}
