import { describe, expect, it } from "vitest";

import { checkpointUlwLoop } from "../src/checkpoint.js";
import type { UlwLoopSuccessCriterion } from "../src/types.js";
import {
	criterion,
	expectCode,
	goal,
	lastLedger,
	passGoal,
	plan,
	repoWith,
	snapshot,
} from "./fixtures/checkpoint-builders.js";

describe("checkpointUlwLoop status=complete criteria gate", () => {
	it("#given essential pass and non-essential pending #when non-final checkpoint completes #then it accepts", async () => {
		const repo = await repoWith(
			plan([
				goal({
					successCriteria: [
						criterion("C001", "pass", { essential: true }),
						criterion("C002", "pending", { essential: false }),
					],
				}),
				goal({ id: "G002", status: "pending" }),
			]),
		);

		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "implementation done and validation passed",
			codexGoalJson: snapshot("active"),
		});

		expect(result.goal.status).toBe("complete");
		expect((await lastLedger(repo)).kind).toBe("goal_completed");
	});

	it("#given essential pending #when non-final checkpoint completes #then it rejects", async () => {
		const repo = await repoWith(
			plan([
				goal({
					successCriteria: [
						criterion("C001", "pending", { essential: true }),
						criterion("C002", "pass", { essential: false }),
					],
				}),
				goal({ id: "G002", status: "pending" }),
			]),
		);

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G001",
					status: "complete",
					evidence: "implementation done and validation passed",
					codexGoalJson: snapshot("active"),
				}),
			"ulw_loop_criteria_not_all_pass",
		);
	});

	it("THROWS when any essential criterion is fail or blocked", async () => {
		for (const status of ["fail", "blocked"] satisfies UlwLoopSuccessCriterion["status"][]) {
			const repo = await repoWith(
				plan([
					goal({
						successCriteria: [
							criterion("C001", "pass", { essential: true }),
							criterion("C002", status, { essential: true }),
							criterion("C003", "pass", { essential: false }),
						],
					}),
				]),
			);
			await expectCode(
				() => checkpointUlwLoop(repo, { goalId: "G001", status: "complete", evidence: "done" }),
				"ulw_loop_criteria_not_all_pass",
			);
		}
	});

	it("THROWS when criteria list is empty", async () => {
		const repo = await repoWith(plan([goal({ successCriteria: [] }), goal({ id: "G002", status: "pending" })]));

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G001",
					status: "complete",
					evidence: "done",
					codexGoalJson: snapshot("active"),
				}),
			"ulw_loop_criteria_not_all_pass",
		);
	});

	it("ACCEPTS complete when ALL criteria pass (with valid snapshot)", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));

		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "implementation done and tests passed",
			codexGoalJson: snapshot("active"),
		});

		expect(result.goal.status).toBe("complete");
		expect((await lastLedger(repo)).kind).toBe("goal_completed");
	});
});

describe("checkpointUlwLoop reconciliation (status=complete)", () => {
	it("succeeds when snapshot objective matches expected (aggregate active)", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));

		await expect(
			checkpointUlwLoop(repo, {
				goalId: "G001",
				status: "complete",
				evidence: "work complete and validation passed",
				codexGoalJson: snapshot("active"),
			}),
		).resolves.toMatchObject({ goal: { status: "complete" } });
	});

	it("throws on mismatched objective", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G001",
					status: "complete",
					evidence: "work complete and validation passed",
					codexGoalJson: snapshot("active", "wrong objective"),
				}),
			"ulw_loop_codex_snapshot_mismatch",
		);
	});

	it("throws on mismatched status (snapshot complete when expected active)", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G001",
					status: "complete",
					evidence: "work complete and validation passed",
					codexGoalJson: snapshot("complete"),
				}),
			"ulw_loop_codex_snapshot_mismatch",
		);
	});
});
