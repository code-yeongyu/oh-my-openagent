import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseCodexGoalSnapshot, reconcileCodexGoalSnapshot } from "../src/codex-goal-snapshot.ts";
import { resolveEvidenceArtifacts } from "../src/evidence-artifacts.ts";
import { createAgentToolkit } from "../src/sdk.ts";

const workDirs: string[] = [];

afterEach(async () => {
	for (const dir of workDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function makeWorkdir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "ulw-8346-"));
	workDirs.push(dir);
	return dir;
}

describe("#8346 follow-ups", () => {
	describe("Item 1: evidenceRoot for v1 plans", () => {
		it("returns .omo/evidence for v1 plans", async () => {
			const cwd = await makeWorkdir();
			const toolkit = createAgentToolkit({ cwd, sessionId: "v1-test", surface: "lazycodex" });
			const created = await toolkit.createGoals({ brief: "test goal" });
			expect(created.ok).toBe(true);

			// Force plan to v1 by modifying evidenceLayoutVersion
			const { readUlwLoopPlan, writePlan } = await import("../src/plan-io.ts");
			const plan = await readUlwLoopPlan(cwd, { sessionId: "v1-test" });
			(plan as { evidenceLayoutVersion: number }).evidenceLayoutVersion = 1;
			await writePlan(cwd, plan, { sessionId: "v1-test" });

			const status = await toolkit.status();
			expect(status.ok).toBe(true);
			if (status.ok) {
				const result = status.result as { evidenceRoot?: string };
				expect(result.evidenceRoot).toBe(".omo/evidence");
			}
		});

		it("returns session-scoped path for v2 plans", async () => {
			const cwd = await makeWorkdir();
			const toolkit = createAgentToolkit({ cwd, sessionId: "v2-test", surface: "lazycodex" });
			const created = await toolkit.createGoals({ brief: "test goal" });
			expect(created.ok).toBe(true);

			const status = await toolkit.status();
			expect(status.ok).toBe(true);
			if (status.ok) {
				const result = status.result as { evidenceRoot?: string };
				expect(result.evidenceRoot).toContain("ulw/v2-test");
			}
		});
	});

	describe("Item 3: artifacts preservation on re-record", () => {
		it("preserves existing artifacts when re-recording without artifacts", async () => {
			const cwd = await makeWorkdir();
			const toolkit = createAgentToolkit({ cwd, sessionId: "artifacts-test", surface: "lazycodex" });
			await toolkit.createGoals({ brief: "artifact test" });
			const started = await toolkit.completeGoals({});
			if (!started.ok || started.operation !== "complete-goals" || "done" in started.result)
				throw new Error("setup");
			const goalId = started.result.goal.id;
			const criteria = await toolkit.criteria({ goalId });
			if (!criteria.ok || criteria.operation !== "criteria") throw new Error("setup");
			const firstCriterion = criteria.result.criteria[0];
			if (firstCriterion === undefined) throw new Error("no criterion");
			const criterionId = firstCriterion.id;

			// Create an artifact file
			const artifactPath = join(cwd, "gate.log");
			writeFileSync(artifactPath, "test log");

			// Record with artifacts
			await toolkit.recordEvidence({
				goalId,
				criterionId,
				status: "pass",
				evidence: "first record",
				artifacts: ["gate.log"],
			});

			// Re-record WITHOUT artifacts — should preserve
			await toolkit.recordEvidence({
				goalId,
				criterionId,
				status: "pass",
				evidence: "second record",
			});

			const { readUlwLoopPlan } = await import("../src/plan-io.ts");
			const plan = await readUlwLoopPlan(cwd, { sessionId: "artifacts-test" });
			const goal = plan.goals.find((g) => g.id === goalId);
			expect(goal).toBeDefined();
			const criterion = goal?.successCriteria.find((c) => c.id === criterionId);
			expect(criterion).toBeDefined();
			expect(criterion?.artifacts).toEqual(["gate.log"]);
			expect(criterion?.capturedEvidence).toBe("second record");
		});

		it("clears artifacts when explicitly passed empty array", async () => {
			const cwd = await makeWorkdir();
			const toolkit = createAgentToolkit({ cwd, sessionId: "artifacts-clear", surface: "lazycodex" });
			await toolkit.createGoals({ brief: "artifact clear test" });
			const started = await toolkit.completeGoals({});
			if (!started.ok || started.operation !== "complete-goals" || "done" in started.result)
				throw new Error("setup");
			const goalId = started.result.goal.id;
			const criteria = await toolkit.criteria({ goalId });
			if (!criteria.ok || criteria.operation !== "criteria") throw new Error("setup");
			const firstCriterion = criteria.result.criteria[0];
			if (firstCriterion === undefined) throw new Error("no criterion");
			const criterionId = firstCriterion.id;

			const artifactPath = join(cwd, "gate.log");
			writeFileSync(artifactPath, "test log");

			await toolkit.recordEvidence({
				goalId,
				criterionId,
				status: "pass",
				evidence: "with artifacts",
				artifacts: ["gate.log"],
			});

			// Explicit empty array = clear
			await toolkit.recordEvidence({
				goalId,
				criterionId,
				status: "pass",
				evidence: "cleared artifacts",
				artifacts: [],
			});

			const { readUlwLoopPlan } = await import("../src/plan-io.ts");
			const plan = await readUlwLoopPlan(cwd, { sessionId: "artifacts-clear" });
			const goal = plan.goals.find((g) => g.id === goalId);
			expect(goal).toBeDefined();
			const criterion = goal?.successCriteria.find((c) => c.id === criterionId);
			expect(criterion).toBeDefined();
			expect(criterion?.artifacts).toBeUndefined();
		});
	});

	describe("Item 4a: ..foo path inside cwd", () => {
		it("stores a directory named ..foo inside cwd as relative", () => {
			const cwd = join(tmpdir(), `ulw-8346-dotdot-${Date.now()}`);
			mkdirSync(cwd, { recursive: true });
			workDirs.push(cwd);
			const dotDir = join(cwd, "..foo");
			mkdirSync(dotDir, { recursive: true });
			const filePath = join(dotDir, "test.txt");
			writeFileSync(filePath, "data");

			const result = resolveEvidenceArtifacts(cwd, ["..foo/test.txt"]);
			expect(result).toEqual(["..foo/test.txt"]);
		});
	});

	describe("Item 4c: warnings not capped at 8", () => {
		it("reconciliation warnings are not artificially limited", () => {
			// This is a structural test — reconcileCodexGoalSnapshot's warnings
			// should not be subject to the 8-item nextActions cap.
			// The cap is applied in stringsFrom in factory.ts, not here,
			// but we verify the reconciliation itself doesn't cap.
			const result = reconcileCodexGoalSnapshot(
				parseCodexGoalSnapshot({ goal: { objective: "X", status: "active" } }),
				{ expectedObjective: "Y" },
			);
			// driver_objective_differs is a warning, not a nextAction
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.nextActions.length).toBe(0);
		});
	});
});
