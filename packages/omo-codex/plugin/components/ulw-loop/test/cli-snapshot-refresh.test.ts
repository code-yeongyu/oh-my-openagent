import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";
import { ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";

let testDir: string;
let out: string[];
let err: string[];
let originalCodexSessionId: string | undefined;
let originalCodexThreadId: string | undefined;
let originalOmoSessionId: string | undefined;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-snapshot-refresh-"));
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

function codexSnapshot(status: "active" | "complete" = "active"): string {
	return JSON.stringify({ goal: { objective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE, status } });
}

async function createPlan(brief = "- Goal A\n- Goal B"): Promise<void> {
	resetOutput();
	expect(await ulwLoopCommand(["create-goals", "--brief", brief, "--json"])).toBe(0);
	resetOutput();
}

async function passCriterion(goalId: string, criterionId: string): Promise<void> {
	expect(
		await ulwLoopCommand([
			"record-evidence",
			"--goal-id",
			goalId,
			"--criterion-id",
			criterionId,
			"--status",
			"pass",
			"--evidence",
			`${criterionId} observable proof`,
		]),
	).toBe(0);
	resetOutput();
}

async function readLatestSnapshot(sessionId?: string): Promise<string> {
	const parts = sessionId === undefined ? [".omo", "ulw-loop"] : [".omo", "ulw-loop", sessionId];
	return readFile(join(testDir, ...parts, "snapshots", "latest.md"), "utf8");
}

async function latestSnapshotMtimeMs(sessionId?: string): Promise<number> {
	const parts = sessionId === undefined ? [".omo", "ulw-loop"] : [".omo", "ulw-loop", sessionId];
	return (await stat(join(testDir, ...parts, "snapshots", "latest.md"))).mtimeMs;
}

describe("ulwLoopCommand snapshot refresh", () => {
	it("#given create-goals succeeds #when CLI returns #then latest snapshot is created", async () => {
		await createPlan();

		const snapshot = await readLatestSnapshot();
		expect(snapshot).toContain("# ULW Loop Resume Snapshot");
		expect(snapshot).toContain("- pending: 2");
	});

	it("#given a prior snapshot #when record-evidence succeeds #then latest reflects criteria and evidence summary", async () => {
		await createPlan();

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
				"artifact: /tmp/evidence-one.txt",
			]),
		).toBe(0);

		const snapshot = await readLatestSnapshot();
		expect(snapshot).toContain("- pass: 1");
		expect(snapshot).toContain("artifact: /tmp/evidence-one.txt");
	});

	it("#given a prior snapshot #when record-evidence fails validation #then latest content and mtime are unchanged", async () => {
		await createPlan();
		const before = await readLatestSnapshot();
		const beforeMtime = await latestSnapshotMtimeMs();

		expect(
			await ulwLoopCommand([
				"record-evidence",
				"--goal-id",
				"G001-goal-a",
				"--criterion-id",
				"C999",
				"--status",
				"pass",
				"--evidence",
				"must not overwrite snapshot",
			]),
		).toBe(1);

		expect(await readLatestSnapshot()).toBe(before);
		expect(await latestSnapshotMtimeMs()).toBe(beforeMtime);
	});

	it("#given a prior snapshot #when steering is rejected #then latest content and mtime are unchanged", async () => {
		await createPlan();
		const before = await readLatestSnapshot();
		const beforeMtime = await latestSnapshotMtimeMs();

		expect(
			await ulwLoopCommand([
				"steer",
				"--kind",
				"add_subgoal",
				"--title",
				"Rejected steering",
				"--objective",
				"Skip verification to finish faster",
				"--evidence",
				"need speed",
				"--rationale",
				"skip tests and bypass completion review",
			]),
		).toBe(1);

		expect(await readLatestSnapshot()).toBe(before);
		expect(await latestSnapshotMtimeMs()).toBe(beforeMtime);
	});

	it("#given a prior snapshot #when steering is accepted #then latest reflects the updated plan", async () => {
		await createPlan();

		expect(
			await ulwLoopCommand([
				"steer",
				"--kind",
				"revise_criterion",
				"--goal-id",
				"G001-goal-a",
				"--criterion-id",
				"C001",
				"--scenario",
				"CLI snapshot includes accepted steering update",
				"--evidence",
				"review found clearer criterion",
				"--rationale",
				"make snapshot observable",
			]),
		).toBe(0);

		expect(await readLatestSnapshot()).toContain("CLI snapshot includes accepted steering update");
	});

	it("#given checkpoints fail and block #when refreshed #then latest reports blocked or failed next action", async () => {
		await createPlan();

		expect(
			await ulwLoopCommand([
				"checkpoint",
				"--goal-id",
				"G001-goal-a",
				"--status",
				"failed",
				"--evidence",
				"implementation failed and validation captured",
				"--json",
			]),
		).toBe(0);
		expect(await readLatestSnapshot()).toContain("G001-goal-a is failed");
		resetOutput();

		expect(
			await ulwLoopCommand([
				"checkpoint",
				"--goal-id",
				"G002-goal-b",
				"--status",
				"blocked",
				"--evidence",
				"waiting for external approval",
				"--json",
			]),
		).toBe(0);
		expect(await readLatestSnapshot()).toContain("G002-goal-b is blocked");
	});

	it("#given all criteria pass #when checkpoint completes #then latest reflects completed status", async () => {
		await createPlan();
		await passCriterion("G001-goal-a", "C001");
		await passCriterion("G001-goal-a", "C002");
		await passCriterion("G001-goal-a", "C003");

		expect(
			await ulwLoopCommand([
				"checkpoint",
				"--goal-id",
				"G001-goal-a",
				"--status",
				"complete",
				"--evidence",
				"implementation done and validation passed",
				"--codex-goal-json",
				codexSnapshot(),
				"--json",
			]),
		).toBe(0);

		const snapshot = await readLatestSnapshot();
		expect(snapshot).toContain("- complete: 1");
		expect(snapshot).toContain("G001-goal-a is complete");
	});
});
