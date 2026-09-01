import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";
import { ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";
import { QA_DIR, qualityGateJson } from "./fixtures/quality-gate-builder.js";

let testDir: string;
let out: string[];
let err: string[];
let originalCodexSessionId: string | undefined;
let originalCodexThreadId: string | undefined;
let originalOmoSessionId: string | undefined;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-checkpoint-"));
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

function codexSnapshot(status: "active" | "complete" = "active"): string {
	return JSON.stringify({ goal: { objective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE, status } });
}

async function createPlan(brief = "- Goal A\n- Goal B"): Promise<Record<string, unknown>> {
	resetOutput();
	expect(await ulwLoopCommand(["create-goals", "--brief", brief, "--json"])).toBe(0);
	const parsed = stdoutJson();
	resetOutput();
	return parsed;
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

describe("ulwLoopCommand checkpoint", () => {
	it("REJECTS status=complete when criteria pending", async () => {
		await createPlan();

		expect(
			await ulwLoopCommand([
				"checkpoint",
				"--goal-id",
				"G001-goal-a",
				"--status",
				"complete",
				"--evidence",
				"x",
				"--codex-goal-json",
				codexSnapshot(),
			]),
		).toBe(1);
		expect(err.join("").toLowerCase()).toContain("criteria");
	});

	it("#given essential criteria pass and non-essential criterion pending #when checkpointed through CLI #then it completes", async () => {
		await createPlan();
		await passCriterion("G001-goal-a", "C001");
		await passCriterion("G001-goal-a", "C002");

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
		expect(stdoutJson()).toHaveProperty("goal.status", "complete");
	});

	it("ACCEPTS when all criteria pass", async () => {
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
		expect(stdoutJson()).toHaveProperty("goal.status", "complete");
	});

	it("#given failed checkpoint without codex goal json #when recorded through CLI #then marks the goal failed", async () => {
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

		expect(stdoutJson()).toMatchObject({ ok: true, goal: { id: "G001-goal-a", status: "failed" } });
	});

	it("#given blocked checkpoint without codex goal json #when recorded through CLI #then marks the goal blocked", async () => {
		await createPlan();

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

		expect(stdoutJson()).toMatchObject({ ok: true, goal: { id: "G002-goal-b", status: "blocked" } });
	});

	it("#given final completion with a missing quality-gate artifact #when checkpointed through CLI #then it is rejected", async () => {
		await createPlan("- Goal A");
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
				"final implementation complete and quality gate passed",
				"--codex-goal-json",
				codexSnapshot("complete"),
				"--quality-gate-json",
				await qualityGateJson(testDir, `${QA_DIR}/missing.txt`),
				"--json",
			]),
		).toBe(1);
		expect(err.join("")).toBe("");
		expect(stdoutJson()).toMatchObject({ ok: false, error: { code: "ULW_LOOP_QUALITY_GATE_INVALID" } });
	});
});
