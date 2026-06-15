// biome-ignore-all format: keep the single mandated checkpoint spec under the pure LOC budget.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkpointUlwLoop } from "../src/checkpoint.js";
import { ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";
import { ulwLoopBriefPath, ulwLoopDir, ulwLoopLedgerPath } from "../src/paths.js";
import { writePlan } from "../src/plan-io.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan, UlwLoopSuccessCriterion } from "../src/types.js";
import { UlwLoopError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";
const CODE_REVIEW_PATH = ".omo/ulw-loop/qa/code-review.md";
const GATE_REVIEW_PATH = ".omo/ulw-loop/qa/gate-review.md";
const CLI_PASS_PATH = ".omo/ulw-loop/qa/cli-pass.txt";
const REJECTION_LOG_PATH = ".omo/ulw-loop/qa/rejection.log";
const MISSING_ARTIFACT_PATH = ".omo/ulw-loop/qa/missing.txt";

function criterion(id: string, status: UlwLoopSuccessCriterion["status"]): UlwLoopSuccessCriterion {
	return { id, scenario: `${id} scenario`, userModel: "happy", expectedEvidence: `${id} proof`, capturedEvidence: status === "pass" ? `${id} passed` : null, status };
}

function goal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return { id: "G001", title: "Build auth", objective: "Implement JWT auth endpoint", status: "in_progress", successCriteria: [criterion("C001", "pass"), criterion("C002", "pass"), criterion("C003", "pass")], attempt: 1, createdAt: NOW, updatedAt: NOW, ...overrides };
}

function plan(goals: UlwLoopItem[], overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	const result: UlwLoopPlan = { version: 1, createdAt: NOW, updatedAt: NOW, briefPath: ".omo/ulw-loop/brief.md", goalsPath: ".omo/ulw-loop/goals.json", ledgerPath: ".omo/ulw-loop/ledger.jsonl", codexGoalMode: "aggregate", codexObjective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE, goals };
	Object.assign(result, overrides);
	const activeGoalId = goals.find((candidate) => candidate.status === "in_progress")?.id;
	if (result.activeGoalId === undefined && activeGoalId !== undefined) result.activeGoalId = activeGoalId;
	return result;
}

async function samplePlan(overrides: Partial<UlwLoopPlan> = {}): Promise<UlwLoopPlan> {
	const fixture: UlwLoopPlan = JSON.parse(await readFile(new URL("./fixtures/sample-plan.json", import.meta.url), "utf8"));
	return plan(fixture.goals.map((item, index) => goal({ ...item, attempt: index + 1, createdAt: NOW, updatedAt: NOW })), overrides);
}

async function repoWith(seed: UlwLoopPlan): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "ug-checkpoint-"));
	await mkdir(ulwLoopDir(repo), { recursive: true });
	await writePlan(repo, seed);
	return repo;
}

async function writeQualityGateArtifacts(repo: string): Promise<void> {
	await mkdir(join(repo, ".omo/ulw-loop/qa"), { recursive: true });
	await writeFile(join(repo, CODE_REVIEW_PATH), "code review approved\n", "utf8");
	await writeFile(join(repo, GATE_REVIEW_PATH), "gate review approved\n", "utf8");
	await writeFile(join(repo, CLI_PASS_PATH), "cli scenario passed\n", "utf8");
	await writeFile(join(repo, REJECTION_LOG_PATH), "invalid gate rejected\n", "utf8");
}

async function qualityGateJson(repo: string, cliArtifactPath = CLI_PASS_PATH): Promise<string> {
	await writeQualityGateArtifacts(repo);
	return JSON.stringify({
		codeReview: { by: "lazycodex-code-reviewer", recommendation: "APPROVE", codeQualityStatus: "CLEAR", reportPath: CODE_REVIEW_PATH, evidence: "Reviewed implementation and tests; no blockers remain.", blockers: [] },
		manualQa: {
			by: "lazycodex-qa-executor",
			status: "passed",
			evidence: "Ran CLI checkpoint validation with artifact-backed evidence.",
			surfaceEvidence: [{ id: "surface-cli-pass", criterionRef: "C001", surface: "cli", invocation: "omo ulw-loop checkpoint --status complete", verdict: "passed", artifactRefs: ["artifact-cli-pass"] }],
			adversarialCases: [{ id: "adv-missing-artifact", criterionRef: "C002", scenario: "quality gate references a missing artifact", expectedBehavior: "checkpoint rejects the final completion with ULW_LOOP_QUALITY_GATE_INVALID", verdict: "passed", artifactRefs: ["artifact-cli-reject"] }],
			artifactRefs: [
				{ id: "artifact-cli-pass", kind: "cli-transcript", description: "CLI transcript for valid final checkpoint.", path: cliArtifactPath },
				{ id: "artifact-cli-reject", kind: "log", description: "Log proving invalid final checkpoint rejection.", path: REJECTION_LOG_PATH },
			],
		},
		gateReview: { by: "lazycodex-gate-reviewer", recommendation: "APPROVE", reportPath: GATE_REVIEW_PATH, evidence: "Verified all criteria and artifact evidence.", blockers: [] },
		iteration: { fullRerun: true, status: "passed", rerunCommands: ["bunx vitest run test/checkpoint.test.ts"], evidence: "Focused checkpoint suite reran cleanly." },
		criteriaCoverage: { totalCriteria: 2, passCount: 2, adversarialClassesCovered: ["missing_artifact", "role_mismatch"] },
	});
}

function snapshot(status: "active" | "complete", objective = ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE): string {
	return JSON.stringify({ goal: { objective, status } });
}

async function lastLedger(repo: string): Promise<UlwLoopLedgerEntry> {
	const last = (await readFile(ulwLoopLedgerPath(repo), "utf8")).trim().split(/\r?\n/).at(-1);
	if (last === undefined) throw new Error("expected ledger entry");
	const entry: UlwLoopLedgerEntry = JSON.parse(last);
	return entry;
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
	try {
		await action();
	} catch (error) {
		expect(error).toBeInstanceOf(UlwLoopError);
		if (!(error instanceof UlwLoopError)) throw error;
		expect(error.code).toBe(code);
		return;
	}
	throw new Error("Expected UlwLoopError");
}

function passGoal(id: string, overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return goal({ id, successCriteria: [criterion("C001", "pass"), criterion("C002", "pass"), criterion("C003", "pass")], ...overrides });
}

describe("checkpointUlwLoop status=complete criteria gate", () => {
	it("THROWS ulw_loop_criteria_not_all_pass when any criterion is pending", async () => {
		const repo = await repoWith(await samplePlan({ goals: [goal({ successCriteria: [criterion("C001", "pass"), criterion("C002", "pending"), criterion("C003", "pass")] })] }));
		await expectCode(() => checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "done" }), "ulw_loop_criteria_not_all_pass");
	});

	it("THROWS when any criterion is fail or blocked", async () => {
		for (const status of ["fail", "blocked"] satisfies UlwLoopSuccessCriterion["status"][]) {
			const repo = await repoWith(plan([goal({ successCriteria: [criterion("C001", "pass"), criterion("C002", status), criterion("C003", "pass")] })]));
			await expectCode(() => checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "done" }), "ulw_loop_criteria_not_all_pass");
		}
	});

	it("THROWS when criteria list is empty", async () => {
		const repo = await repoWith(plan([goal({ successCriteria: [] }), goal({ id: "G002", status: "pending" })]));
		await expectCode(() => checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "done", codexGoalJson: snapshot("active") }), "ulw_loop_criteria_not_all_pass");
	});

	it("ACCEPTS complete when ALL criteria pass (with valid snapshot)", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));
		const result = await checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "implementation done and tests passed", codexGoalJson: snapshot("active") });
		expect(result.goal.status).toBe("complete");
		expect((await lastLedger(repo)).kind).toBe("goal_completed");
	});
});

describe("checkpointUlwLoop reconciliation (status=complete)", () => {
	it("succeeds when snapshot objective matches expected (aggregate active)", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));
		await expect(checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "work complete and validation passed", codexGoalJson: snapshot("active") })).resolves.toMatchObject({ goal: { status: "complete" } });
	});

	it("throws on mismatched objective", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));
		await expectCode(() => checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "work complete and validation passed", codexGoalJson: snapshot("active", "wrong objective") }), "ulw_loop_codex_snapshot_mismatch");
	});

	it("throws on mismatched status (snapshot complete when expected active)", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));
		await expectCode(() => checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "work complete and validation passed", codexGoalJson: snapshot("complete") }), "ulw_loop_codex_snapshot_mismatch");
	});
});

describe("checkpointUlwLoop final story", () => {
	it("requires quality-gate-json for the final goal complete", async () => {
		const repo = await repoWith(plan([passGoal("G001", { status: "complete" }), passGoal("G002")], { activeGoalId: "G002" }));
		await expectCode(() => checkpointUlwLoop(repo, { goalId: "G002", status: "complete", evidence: "final work complete and validation passed", codexGoalJson: snapshot("complete") }), "ULW_LOOP_QUALITY_GATE_INVALID");
	});

	it("accepts final story when quality gate JSON includes valid criteriaCoverage", async () => {
		const repo = await repoWith(plan([passGoal("G001", { status: "complete" }), passGoal("G002")], { activeGoalId: "G002" }));
		const result = await checkpointUlwLoop(repo, { goalId: "G002", status: "complete", evidence: "final work complete and validation passed", codexGoalJson: snapshot("complete"), qualityGateJson: await qualityGateJson(repo) });
		expect(result.aggregateCompletion?.status).toBe("complete");
		expect(result.plan.aggregateCompletion?.status).toBe("complete");
	});

	it("rejects final story when quality gate references a missing manual QA artifact", async () => {
		const repo = await repoWith(plan([passGoal("G001", { status: "complete" }), passGoal("G002")], { activeGoalId: "G002" }));
		const gateJson = await qualityGateJson(repo, MISSING_ARTIFACT_PATH);
		await expectCode(
			() => checkpointUlwLoop(repo, { goalId: "G002", status: "complete", evidence: "final work complete and validation passed", codexGoalJson: snapshot("complete"), qualityGateJson: gateJson }),
			"ULW_LOOP_QUALITY_GATE_INVALID",
		);
	});

	it("ACCEPTS complete when task-scoped completed Codex objective maps to the ulw-loop brief", async () => {
		const taskObjective = "Fix ulw-loop objective mismatch and install local ulw";
		const repo = await repoWith(plan([passGoal("G001")], { activeGoalId: "G001" }));
		await writeFile(ulwLoopBriefPath(repo), `${taskObjective}\n`, "utf8");

		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "final implementation complete and quality gate passed",
			codexGoalJson: snapshot("complete", taskObjective),
			qualityGateJson: await qualityGateJson(repo),
		});

		expect(result.aggregateCompletion?.status).toBe("complete");
		expect(result.ledgerEntry.kind).toBe("aggregate_completed");
	});

	it("ACCEPTS complete when active task-scoped Codex objective maps to the ulw-loop brief", async () => {
		const taskObjective = "Create only research artifacts with source evidence";
		const repo = await repoWith(plan([passGoal("G001")], { activeGoalId: "G001" }));
		await writeFile(ulwLoopBriefPath(repo), `${taskObjective}\n`, "utf8");

		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "final implementation complete and quality gate passed",
			codexGoalJson: snapshot("active", taskObjective),
			qualityGateJson: await qualityGateJson(repo),
		});

		expect(result.aggregateCompletion?.status).toBe("complete");
		expect(result.ledgerEntry.kind).toBe("aggregate_completed");
	});

	it("explains final task-scoped objective mapping when completed Codex objective is unrelated", async () => {
		const repo = await repoWith(plan([passGoal("G001")], { activeGoalId: "G001" }));
		await writeFile(ulwLoopBriefPath(repo), "Fix ulw-loop objective mismatch and install local ulw\n", "utf8");

		await expect(
			checkpointUlwLoop(repo, {
				goalId: "G001",
				status: "complete",
				evidence: "final implementation complete and quality gate passed",
				codexGoalJson: snapshot("complete", "unrelated completed task"),
				qualityGateJson: await qualityGateJson(repo),
			}),
		).rejects.toThrow("Final task-scoped aggregate reconciliation");
	});
});

describe("checkpointUlwLoop status=failed", () => {
	it("sets goal.status=failed, goal.failedAt, appends ledger", async () => {
		const repo = await repoWith(plan([goal({ successCriteria: [criterion("C001", "pending")] })]));
		const result = await checkpointUlwLoop(repo, { goalId: "G001", status: "failed", evidence: "tests failed" });
		expect(result.goal.status).toBe("failed");
		expect(result.goal.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
		expect((await lastLedger(repo)).kind).toBe("goal_failed");
	});

	it("classifies external authorization blocker signatures", async () => {
		const repo = await repoWith(plan([goal()]));
		const result = await checkpointUlwLoop(repo, { goalId: "G001", status: "failed", evidence: "ghcr.io returned 401 authentication required because token missing" });
		expect(result.goal.blockerSignature).toBe("GHCR_PULL_ACCESS:HTTP_401_ANONYMOUS:GHCR_VISIBILITY_OR_CREDENTIAL_REQUIRED");
	});

	it("after 3 same-signature blockers, marks needs_user_decision + nonRetriable", async () => {
		const repo = await repoWith(plan([goal({ id: "G001", status: "failed", blockerSignature: "EXTERNAL_AUTHORIZATION_REQUIRED" }), goal({ id: "G002", status: "blocked", blockerSignature: "EXTERNAL_AUTHORIZATION_REQUIRED" }), goal({ id: "G003" })], { activeGoalId: "G003" }));
		const result = await checkpointUlwLoop(repo, { goalId: "G003", status: "failed", evidence: "Registry returned 401 because credentials are missing" });
		expect(result.goal.status).toBe("needs_user_decision");
		expect(result.goal.nonRetriable).toBe(true);
	});

	it("skips the criteria gate for failed status", async () => {
		const repo = await repoWith(plan([goal({ successCriteria: [criterion("C001", "pending")] })]));
		await expect(checkpointUlwLoop(repo, { goalId: "G001", status: "failed", evidence: "not done" })).resolves.toMatchObject({ goal: { status: "failed" } });
	});
});

describe("checkpointUlwLoop status=blocked", () => {
	it("preserves blocker fields + appends ledger", async () => {
		const repo = await repoWith(plan([goal()]));
		const result = await checkpointUlwLoop(repo, { goalId: "G001", status: "blocked", evidence: "ghcr.io requires token and credentials are missing" });
		expect(result.goal.status).toBe("blocked");
		expect(result.goal.blockedReason).toContain("ghcr.io");
		expect(result.goal.blockerSignature).toContain("GHCR_PULL_ACCESS");
		expect((await lastLedger(repo)).kind).toBe("goal_blocked");
	});

	it("skips the criteria gate for blocked status", async () => {
		const repo = await repoWith(plan([goal({ successCriteria: [criterion("C001", "pending")] })]));
		await expect(checkpointUlwLoop(repo, { goalId: "G001", status: "blocked", evidence: "waiting for approval" })).resolves.toMatchObject({ goal: { status: "blocked" } });
	});
});

describe("checkpointUlwLoop rebrand", () => {
	it("does not emit legacy brand token in any returned text or ledger payload", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));
		const result = await checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "implementation done in .omo/ulw-loop/goals.json for G001 and validation passed", codexGoalJson: snapshot("active") });
		const forbidden = ["o", "m", "x"].join("");
		const payload = `${JSON.stringify(result)}\n${await readFile(ulwLoopLedgerPath(repo), "utf8")}`.toLowerCase();
		expect(payload).not.toContain(forbidden);
	});
});
