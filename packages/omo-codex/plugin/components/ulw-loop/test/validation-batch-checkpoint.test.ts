// biome-ignore-all format: compact validation-batch checkpoint tests stay under the pure LOC budget.
import { describe, expect, it } from "vitest";

import { checkpointUlwLoop } from "../src/checkpoint.js";
import { readUlwLoopPlan } from "../src/plan-io.js";
import { criterion, expectCode, goal, plan, repoWith, snapshot } from "./fixtures/checkpoint-builders.js";
import { qualityGateJson } from "./fixtures/quality-gate-builder.js";

const batch = { batchId: "VB001", memberIds: ["G001", "G002"], finalGoalId: "G002" };

describe("validation-batch checkpoint enforcement", () => {
	it("#given an open batch member #when completing the batch final goal #then rejects with batch open", async () => {
		const repo = await repoWith(
			plan([
				goal({ id: "G001", status: "pending" }),
				goal({ id: "G002", status: "in_progress" }),
				goal({ id: "G003", status: "pending" }),
			], { validationBatches: [batch] }),
		);

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G002",
					status: "complete",
					evidence: "batch final implementation done",
					codexGoalJson: snapshot("active"),
					qualityGateJson: "{}",
				}),
			"ULW_LOOP_VALIDATION_BATCH_OPEN",
		);
	});

	it("#given complete members but no gate #when completing the batch final goal #then requires a batch gate", async () => {
		const repo = await repoWith(
			plan([
				goal({ id: "G001", status: "complete" }),
				goal({ id: "G002", status: "in_progress" }),
				goal({ id: "G003", status: "pending" }),
			], { validationBatches: [batch] }),
		);

		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G002",
					status: "complete",
					evidence: "batch final implementation done",
					codexGoalJson: snapshot("active"),
				}),
			"ULW_LOOP_VALIDATION_BATCH_GATE_REQUIRED",
		);
	});

	it("#given a member criterion pending #when the batch gate is present #then rejects pending criteria", async () => {
		const repo = await repoWith(
			plan([
				goal({ id: "G001", status: "complete", successCriteria: [criterion("C001", "pass"), criterion("C002", "pending")] }),
				goal({ id: "G002", status: "in_progress", successCriteria: [criterion("C001", "pass"), criterion("C002", "pass")] }),
				goal({ id: "G003", status: "pending" }),
			], { validationBatches: [batch] }),
		);

		const gateJson = await qualityGateJson(repo, undefined, "G002");
		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G002",
					status: "complete",
					evidence: "batch final implementation done",
					codexGoalJson: snapshot("active"),
					qualityGateJson: gateJson,
				}),
			"ULW_LOOP_VALIDATION_BATCH_CRITERIA_PENDING",
		);
	});

	it("#given all member criteria pass #when coverage counts mismatch #then rejects the gate", async () => {
		const repo = await repoWith(
			plan([
				goal({ id: "G001", status: "complete", successCriteria: [criterion("C001", "pass"), criterion("C002", "pass")] }),
				goal({ id: "G002", status: "in_progress", successCriteria: [criterion("C001", "pass"), criterion("C002", "pass")] }),
				goal({ id: "G003", status: "pending" }),
			], { validationBatches: [batch] }),
		);

		const gateJson = await qualityGateJson(repo, undefined, "G002");
		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G002",
					status: "complete",
					evidence: "batch final implementation done",
					codexGoalJson: snapshot("active"),
					qualityGateJson: gateJson,
				}),
			"ULW_LOOP_VALIDATION_BATCH_GATE_MISMATCH",
		);
	});

	it("#given all batch checks pass #when completing final member #then appends batch closed", async () => {
		const repo = await repoWith(
			plan([
				goal({ id: "G001", status: "complete", successCriteria: [criterion("C001", "pass")] }),
				goal({ id: "G002", status: "in_progress", successCriteria: [criterion("C001", "pass")] }),
				goal({ id: "G003", status: "pending" }),
			], { validationBatches: [batch] }),
		);

		const gate = JSON.parse(await qualityGateJson(repo, undefined, "G002"));
		gate.criteriaCoverage.totalCriteria = 2;
		gate.criteriaCoverage.passCount = 2;
		await checkpointUlwLoop(repo, {
			goalId: "G002",
			status: "complete",
			evidence: "batch final implementation done",
			codexGoalJson: snapshot("active"),
			qualityGateJson: JSON.stringify(gate),
		});

		expect((await readUlwLoopPlan(repo)).goals.find((item) => item.id === "G002")?.status).toBe("complete");
	});
});
