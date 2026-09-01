import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";
import { ulwLoopLedgerPath } from "../src/paths.ts";

let testDir: string;
let out: string[];
let originalCodexSessionId: string | undefined;
let originalCodexThreadId: string | undefined;
let originalOmoSessionId: string | undefined;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-complete-"));
	out = [];
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

function resetOutput(): void {
	out = [];
}

function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

async function ledgerKinds(): Promise<string[]> {
	const raw = await readFile(ulwLoopLedgerPath(testDir), "utf8");
	return raw
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => (JSON.parse(line) as { kind: string }).kind);
}

async function createPlan(): Promise<void> {
	expect(await ulwLoopCommand(["create-goals", "--brief", "- Goal A\n- Goal B", "--json"])).toBe(0);
	resetOutput();
}

describe("ulwLoopCommand complete-goals", () => {
	it("#given a pending plan #when complete-goals starts the next goal #then returns a Codex create_goal instruction", async () => {
		await createPlan();

		expect(await ulwLoopCommand(["complete-goals", "--json"])).toBe(0);

		expect(stdoutJson()).toMatchObject({
			ok: true,
			goal: { status: "in_progress" },
			instruction: { json: { objective: expect.any(String) } },
		});
		expect(JSON.stringify(stdoutJson())).not.toContain('"status":"active"');
	});

	it("#given an in-progress goal #when complete-goals is called again #then it resumes without appending to the ledger", async () => {
		// given
		await createPlan();
		expect(await ulwLoopCommand(["complete-goals", "--json"])).toBe(0);
		expect(stdoutJson()).toMatchObject({ ok: true, resumed: false, goal: { status: "in_progress" } });
		expect(await ledgerKinds()).toEqual(["plan_created", "goal_started"]);
		resetOutput();

		// when
		expect(await ulwLoopCommand(["complete-goals", "--json"])).toBe(0);

		// then
		expect(stdoutJson()).toMatchObject({ ok: true, resumed: true, goal: { status: "in_progress" } });
		expect(await ledgerKinds()).toEqual(["plan_created", "goal_started"]);
	});
});
