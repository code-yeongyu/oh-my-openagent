import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	MAX_PROCESS_OUTPUT_BYTES,
	resolveCommentCheckerBinary,
	runCommentChecker,
	spawnProcess,
} from "../src/runner.js";

describe("spawnProcess", () => {
	it("#given noisy checker process #when output exceeds cap #then stderr is bounded", async () => {
		// given
		const maxOutputBytes = 16;

		// when
		const result = await spawnProcess(
			process.execPath,
			["-e", "process.stderr.write('x'.repeat(40)); process.exit(2);"],
			"",
			maxOutputBytes,
		);

		// then
		expect(MAX_PROCESS_OUTPUT_BYTES).toBeGreaterThan(maxOutputBytes);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe(`${"x".repeat(maxOutputBytes)}\n[stderr truncated after 16 bytes]`);
	});
});

describe("resolveCommentCheckerBinary", () => {
	it("#given installed checker package #when resolving binary #then returns existing checker binary", () => {
		// given / when
		const binaryPath = resolveCommentCheckerBinary();

		// then
		expect(binaryPath).toBeDefined();
		expect(binaryPath ?? "").toContain("comment-checker");
		expect(existsSync(binaryPath ?? "")).toBe(true);
	});
});

describe("runCommentChecker", () => {
	it("#given missing checker binary #when runner starts #then returns missing result", async () => {
		// given / when
		const result = await runCommentChecker(
			{
				session_id: "session-1",
				tool_name: "Write",
				transcript_path: "",
				cwd: "/repo",
				hook_event_name: "PostToolUse",
				tool_input: {
					file_path: "src/example.ts",
					content: "const value = 1;\n",
				},
			},
			{
				resolveBinary: () => undefined,
			},
		);

		// then
		expect(result.status).toBe("missing");
	});
});
