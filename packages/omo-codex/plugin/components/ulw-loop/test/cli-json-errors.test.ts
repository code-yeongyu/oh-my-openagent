import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";

let testDir: string;
let out: string[];
let err: string[];
let originalCodexSessionId: string | undefined;
let originalCodexThreadId: string | undefined;
let originalOmoSessionId: string | undefined;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-json-err-"));
	out = [];
	err = [];
	originalCodexSessionId = process.env["CODEX_SESSION_ID"];
	originalCodexThreadId = process.env["CODEX_THREAD_ID"];
	originalOmoSessionId = process.env["OMO_ULW_LOOP_SESSION_ID"];
	delete process.env["CODEX_SESSION_ID"];
	delete process.env["CODEX_THREAD_ID"];
	delete process.env["OMO_ULW_LOOP_SESSION_ID"];
	vi.spyOn(process, "cwd").mockReturnValue(testDir);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		out.push(chunk.toString());
		return true;
	});
	vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		err.push(chunk.toString());
		return true;
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	if (originalCodexSessionId === undefined) delete process.env["CODEX_SESSION_ID"];
	else process.env["CODEX_SESSION_ID"] = originalCodexSessionId;
	if (originalCodexThreadId === undefined) delete process.env["CODEX_THREAD_ID"];
	else process.env["CODEX_THREAD_ID"] = originalCodexThreadId;
	if (originalOmoSessionId === undefined) delete process.env["OMO_ULW_LOOP_SESSION_ID"];
	else process.env["OMO_ULW_LOOP_SESSION_ID"] = originalOmoSessionId;
	await rm(testDir, { recursive: true, force: true });
});

function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

describe("ulwLoopCommand --json error contract", () => {
	it("#given no plan #when status --json #then emits JSON error on stdout, nothing on stderr, exit 0 (missing plan is not an error for JSON consumers)", async () => {
		const code = await ulwLoopCommand(["status", "--json"]);

		expect(code).toBe(0);
		expect(err.join("")).toBe("");
		expect(stdoutJson()).toMatchObject({
			ok: false,
			error: { code: "ULW_LOOP_PLAN_MISSING", message: expect.stringContaining("No ulw-loop plan") },
		});
	});

	it("#given no plan #when complete-goals --json #then emits JSON error on stdout, exit 1", async () => {
		const code = await ulwLoopCommand(["complete-goals", "--json"]);

		expect(code).toBe(1);
		expect(err.join("")).toBe("");
		expect(stdoutJson()).toMatchObject({ ok: false, error: { code: "ULW_LOOP_PLAN_MISSING" } });
	});

	it("#given an unknown subcommand #when --json #then emits a JSON error (not help text), exit 1", async () => {
		const code = await ulwLoopCommand(["wat", "--json"]);

		expect(code).toBe(1);
		expect(out.join("")).not.toContain("Usage:");
		expect(stdoutJson()).toMatchObject({ ok: false, error: { code: expect.any(String) } });
	});

	it("#given a malformed required flag #when --json #then surfaces the UlwLoopError code with details on stdout", async () => {
		const code = await ulwLoopCommand(["criteria", "--json"]);

		expect(code).toBe(1);
		expect(err.join("")).toBe("");
		expect(stdoutJson()).toMatchObject({
			ok: false,
			error: { code: "ULW_LOOP_ARGUMENT_MISSING", details: { flag: "--goal-id" } },
		});
	});
});
