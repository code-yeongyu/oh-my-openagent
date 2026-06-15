import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { checkpointUlwLoop } from "../src/checkpoint.js";
import { ulwLoopBriefPath } from "../src/paths.js";
import { startNextUlwLoop } from "../src/plan-crud.js";
import { criterion, expectCode, goal, passGoal, plan, repoWith, snapshot } from "./fixtures/checkpoint-builders.js";
import { MISSING_ARTIFACT_PATH, qualityGateJson } from "./fixtures/quality-gate-builder.js";

describe("checkpointUlwLoop final story", () => {
	it("requires quality-gate-json for the final goal complete", async () => {
		const repo = await repoWith(
			plan([passGoal("G001", { status: "complete" }), passGoal("G002")], { activeGoalId: "G002" }),
		);
		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G002",
					status: "complete",
					evidence: "final work complete and validation passed",
					codexGoalJson: snapshot("complete"),
				}),
			"ULW_LOOP_QUALITY_GATE_INVALID",
		);
	});

	it("accepts final story when quality gate JSON includes valid criteriaCoverage", async () => {
		const repo = await repoWith(
			plan([passGoal("G001", { status: "complete" }), passGoal("G002")], { activeGoalId: "G002" }),
		);

		const result = await checkpointUlwLoop(repo, {
			goalId: "G002",
			status: "complete",
			evidence: "final work complete and validation passed",
			codexGoalJson: snapshot("complete"),
			qualityGateJson: await qualityGateJson(repo),
		});

		expect(result.aggregateCompletion?.status).toBe("complete");
		expect(result.plan.aggregateCompletion?.status).toBe("complete");
	});

	it("rejects final story until earlier non-essential criteria pass", async () => {
		const earlier = goal({
			id: "G001",
			status: "complete",
			successCriteria: [
				criterion("C001", "pass", { essential: true }),
				criterion("C002", "pending", { essential: false }),
			],
		});
		const repo = await repoWith(plan([earlier, passGoal("G002")], { activeGoalId: "G002" }));
		const gateJson = await qualityGateJson(repo);

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G002",
					status: "complete",
					evidence: "final work complete and validation passed",
					codexGoalJson: snapshot("complete"),
					qualityGateJson: gateJson,
				}),
			"ulw_loop_criteria_not_all_pass",
		);
	});

	it("rejects final story when quality gate references a missing manual QA artifact", async () => {
		const repo = await repoWith(
			plan([passGoal("G001", { status: "complete" }), passGoal("G002")], { activeGoalId: "G002" }),
		);
		const gateJson = await qualityGateJson(repo, MISSING_ARTIFACT_PATH);

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G002",
					status: "complete",
					evidence: "final work complete and validation passed",
					codexGoalJson: snapshot("complete"),
					qualityGateJson: gateJson,
				}),
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

	it("keeps aggregate open when non-final task-scoped Codex completion maps to the brief", async () => {
		const taskObjective = "Implement first accepted story";
		const first = goal({
			id: "G001",
			status: "in_progress",
			successCriteria: [
				criterion("C001", "pass", { essential: true }),
				criterion("C002", "pending", { essential: false }),
			],
		});
		const second = goal({ id: "G002", status: "pending", objective: "Implement second accepted story" });
		const repo = await repoWith(plan([first, second], { activeGoalId: "G001" }));
		await writeFile(ulwLoopBriefPath(repo), `${taskObjective}\n`, "utf8");

		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "G001 updated .omo/ulw-loop/goals.json after implementation completed and validation passed",
			codexGoalJson: snapshot("complete", taskObjective),
			qualityGateJson: await qualityGateJson(repo),
		});
		const next = await startNextUlwLoop(repo);

		expect(result.aggregateCompletion).toBeUndefined();
		expect(result.plan.aggregateCompletion).toBeUndefined();
		expect(result.ledgerEntry.kind).toBe("goal_completed");
		expect(next).toMatchObject({ goal: { id: "G002", status: "in_progress" } });
	});

	it("requires all criteria for per-story completion", async () => {
		const current = goal({
			successCriteria: [
				criterion("C001", "pass", { essential: true }),
				criterion("C002", "pending", { essential: false }),
			],
		});
		const repo = await repoWith(plan([current], { codexGoalMode: "per_story", activeGoalId: "G001" }));

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G001",
					status: "complete",
					evidence: "per-story implementation complete and validation passed",
					codexGoalJson: snapshot("complete", current.objective),
				}),
			"ulw_loop_criteria_not_all_pass",
		);
	});
});
