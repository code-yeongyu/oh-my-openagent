import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

const QA_DIR = ".omo/ulw-loop/qa";
const CODE_REVIEW_PATH = `${QA_DIR}/code-review.md`;
const GATE_REVIEW_PATH = `${QA_DIR}/gate-review.md`;
const CLI_PASS_PATH = `${QA_DIR}/cli-pass.txt`;
const REJECTION_LOG_PATH = `${QA_DIR}/rejection.log`;

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

async function qualityGateJson(missingArtifactPath: string): Promise<string> {
	await mkdir(join(testDir, QA_DIR), { recursive: true });
	await writeFile(join(testDir, CODE_REVIEW_PATH), "code review approved\n", "utf8");
	await writeFile(join(testDir, GATE_REVIEW_PATH), "gate review approved\n", "utf8");
	await writeFile(join(testDir, CLI_PASS_PATH), "cli scenario passed\n", "utf8");
	await writeFile(join(testDir, REJECTION_LOG_PATH), "invalid checkpoint rejected\n", "utf8");
	return JSON.stringify({
		codeReview: {
			by: "lazycodex-code-reviewer",
			recommendation: "APPROVE",
			codeQualityStatus: "CLEAR",
			reportPath: CODE_REVIEW_PATH,
			evidence: "Reviewed implementation and tests; no blockers remain.",
			blockers: [],
		},
		manualQa: {
			by: "lazycodex-qa-executor",
			status: "passed",
			evidence: "Ran CLI checkpoint validation with artifact-backed evidence.",
			surfaceEvidence: [
				{
					id: "surface-cli-pass",
					criterionRef: "C001",
					surface: "cli",
					invocation: "omo ulw-loop checkpoint --status complete",
					verdict: "passed",
					artifactRefs: ["artifact-cli-pass"],
				},
			],
			adversarialCases: [
				{
					id: "adv-missing-artifact",
					criterionRef: "C002",
					scenario: "quality gate references a missing artifact",
					expectedBehavior: "CLI rejects final completion with ULW_LOOP_QUALITY_GATE_INVALID",
					verdict: "passed",
					artifactRefs: ["artifact-cli-reject"],
				},
			],
			artifactRefs: [
				{
					id: "artifact-cli-pass",
					kind: "cli-transcript",
					description: "CLI transcript for valid checkpoint.",
					path: missingArtifactPath,
				},
				{
					id: "artifact-cli-reject",
					kind: "log",
					description: "Log proving invalid checkpoint rejection.",
					path: REJECTION_LOG_PATH,
				},
			],
		},
		gateReview: {
			by: "lazycodex-gate-reviewer",
			recommendation: "APPROVE",
			reportPath: GATE_REVIEW_PATH,
			evidence: "Verified all criteria and artifact evidence.",
			blockers: [],
		},
		iteration: {
			fullRerun: true,
			status: "passed",
			rerunCommands: ["bunx vitest run test/cli-checkpoint.test.ts"],
			evidence: "Focused CLI checkpoint suite reran cleanly.",
		},
		criteriaCoverage: {
			totalCriteria: 2,
			passCount: 2,
			adversarialClassesCovered: ["missing_artifact", "cli_checkpoint"],
		},
	});
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
				await qualityGateJson(`${QA_DIR}/missing.txt`),
				"--json",
			]),
		).toBe(1);
		expect(err.join("")).toBe("");
		expect(stdoutJson()).toMatchObject({ ok: false, error: { code: "ULW_LOOP_QUALITY_GATE_INVALID" } });
	});
});
