import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-snapshot-preservation-"));
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

function resetOutput(): void {
	out = [];
	err = [];
}

function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

async function createPlan(): Promise<void> {
	resetOutput();
	expect(await ulwLoopCommand(["create-goals", "--brief", "- Goal A\n- Goal B", "--json"])).toBe(0);
	resetOutput();
}

async function readLatestSnapshot(sessionId?: string): Promise<string> {
	const parts = sessionId === undefined ? [".omo", "ulw-loop"] : [".omo", "ulw-loop", sessionId];
	return readFile(join(testDir, ...parts, "snapshots", "latest.md"), "utf8");
}

describe("ulwLoopCommand snapshot preservation", () => {
	it("#given scoped commands #when mutating scoped state #then latest is written only under the scoped snapshot path", async () => {
		expect(
			await ulwLoopCommand(["create-goals", "--session-id", "scoped-one", "--brief", "- Scoped", "--json"]),
		).toBe(0);
		resetOutput();

		expect(
			await ulwLoopCommand([
				"record-evidence",
				"--session-id",
				"scoped-one",
				"--goal-id",
				"G001-scoped",
				"--criterion-id",
				"C001",
				"--status",
				"pass",
				"--evidence",
				"scoped evidence only",
			]),
		).toBe(0);

		expect(await readLatestSnapshot("scoped-one")).toContain("scoped evidence only");
		await expect(readFile(join(testDir, ".omo/ulw-loop/snapshots/latest.md"), "utf8")).rejects.toThrow();
	});

	it("#given a prior snapshot #when snapshot write fails after a mutation #then command succeeds with a warning and preserves latest", async () => {
		await createPlan();
		const before = await readLatestSnapshot();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-29T09:00:00.000Z"));
		const tmpSnapshotPath = join(testDir, ".omo/ulw-loop/snapshots", `latest.md.${process.pid}.${Date.now()}.tmp`);
		await mkdir(tmpSnapshotPath);

		try {
			expect(
				await ulwLoopCommand([
					"record-evidence",
					"--goal-id",
					"G001-goal-a",
					"--criterion-id",
					"C001",
					"--status",
					"pass",
					"--evidence",
					"write failure must preserve latest",
					"--json",
				]),
			).toBe(0);
		} finally {
			vi.useRealTimers();
		}

		expect(stdoutJson()).toMatchObject({ ok: true });
		expect(err.join("")).toContain("[ulw-loop] warning: ULW_LOOP_SNAPSHOT_WRITE_FAILED:");
		expect(err.join("")).toContain(
			"Failed to refresh .omo/ulw-loop/snapshots/latest.md after ulw-loop mutation; previous latest snapshot was preserved.",
		);
		expect(await readLatestSnapshot()).toBe(before);
		expect(await readFile(join(testDir, ".omo/ulw-loop/goals.json"), "utf8")).toContain(
			"write failure must preserve latest",
		);
		expect(await readFile(join(testDir, ".omo/ulw-loop/ledger.jsonl"), "utf8")).toContain(
			"write failure must preserve latest",
		);
	});
});
