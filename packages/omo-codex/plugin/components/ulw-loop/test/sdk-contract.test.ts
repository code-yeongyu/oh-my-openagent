import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedDefaultSuccessCriteria } from "../src/plan-crud.js";
import { readUlwLoopPlan } from "../src/plan-io.js";
import {
	createAgentToolkit,
	type ToolkitContext,
	type ToolkitDispatchRequest,
	ULW_LOOP_MANIFEST,
	ULW_LOOP_OPERATIONS,
} from "../src/sdk.js";

describe("agent toolkit SDK contract", () => {
	it("exposes exactly the ten existing operations in its manifest", () => {
		expect(ULW_LOOP_OPERATIONS).toEqual([
			"help",
			"create-goals",
			"status",
			"complete-goals",
			"checkpoint",
			"steer",
			"add-goal",
			"criteria",
			"record-evidence",
			"record-review-blockers",
		]);
		expect(ULW_LOOP_MANIFEST.operations.map((operation) => operation.name)).toEqual(ULW_LOOP_OPERATIONS);
	});

	it("fails closed for an absent session identity", () => {
		expect(() => createAgentToolkit({ cwd: ".", sessionId: "", surface: "lazycodex" })).toThrow(
			"ULW_LOOP_SESSION_ID_REQUIRED",
		);
	});

	it("uses explicit surface roles for SDK checkpoint templates", async () => {
		for (const surface of ["omo-senpi", "lazycodex"] as const) {
			const cwd = await mkdtemp(join(tmpdir(), `ulw-sdk-template-${surface}-`));
			try {
				const toolkit = createAgentToolkit({ cwd, sessionId: `template-${surface}`, surface });
				const created = await toolkit.createGoals({ brief: "Template fixture" });
				expect(created.ok).toBe(true);
				const template = await toolkit.checkpoint({ printTemplate: true });
				expect(template.ok).toBe(true);
				if (!template.ok) return;
				expect(template.operation).toBe("checkpoint");
				expect("qualityGateTemplate" in template.result).toBe(true);
				if (!("qualityGateTemplate" in template.result)) return;
				expect(template.result.qualityGateTemplate["manualQa"]).toMatchObject({ by: "main-session" });
				expect(template.result.qualityGateTemplate["gateReview"]).toMatchObject({
					by: surface === "omo-senpi" ? "category:deep" : "main-session",
				});
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
		}
	});

	it("returns the stable unknown-operation error at the public dispatch boundary", async () => {
		const toolkit = createAgentToolkit({ cwd: ".", sessionId: "sdk-contract", surface: "lazycodex" });
		const result = await toolkit.dispatch({ operation: "does-not-exist" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("ULW_LOOP_OPERATION_UNKNOWN");
	});

	it("calls every operation through typed structured envelopes on a session-scoped fixture", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "ulw-sdk-contract-"));
		try {
			const context: ToolkitContext = { cwd, sessionId: "sdk-contract", surface: "lazycodex" };
			const hookOperations: string[] = [];
			const toolkit = createAgentToolkit(context, {
				hooks: {
					onOperation: ({ operation }) => {
						hookOperations.push(operation);
					},
				},
			});
			const request = async (value: ToolkitDispatchRequest) => {
				const response = await toolkit.dispatch(value);
				expect(response.ok).toBe(true);
				return response;
			};

			await request({ operation: "help", args: {} });
			await request({ operation: "create-goals", args: { brief: "Build the SDK fixture" } });
			await request({ operation: "status", args: {} });
			const started = await request({ operation: "complete-goals", args: {} });
			if (!started.ok || started.operation !== "complete-goals" || "done" in started.result)
				throw new Error("fixture did not start a goal");
			const goalId = started.result.goal.id;
			const criterionId = seedDefaultSuccessCriteria(0, "Build the SDK fixture")[0]?.id;
			if (criterionId === undefined) throw new Error("fixture has no criterion");
			await request({ operation: "criteria", args: { goalId } });
			await request({
				operation: "record-evidence",
				args: { goalId, criterionId, status: "pass", evidence: "fixture proof" },
			});
			await request({
				operation: "steer",
				args: {
					kind: "annotate_ledger",
					source: "cli",
					evidence: "fixture observation",
					rationale: "fixture rationale",
				},
			});
			const plan = await readUlwLoopPlan(cwd, { sessionId: context.sessionId });
			const review = await request({
				operation: "record-review-blockers",
				args: {
					goalId,
					title: "Review follow-up",
					objective: "Exercise review blockers",
					evidence: "fixture review evidence",
					codexGoalJson: JSON.stringify({ goal: { objective: plan.codexObjective, status: "active" } }),
				},
			});
			if (!review.ok || review.operation !== "record-review-blockers")
				throw new Error("fixture did not record review blockers");
			await request({
				operation: "checkpoint",
				args: { goalId: review.result.newGoal.id, status: "failed", evidence: "fixture failure" },
			});
			await request({
				operation: "add-goal",
				args: { title: "Extra fixture goal", objective: "Exercise add-goal" },
			});
			const operationCount = hookOperations.length;
			expect(operationCount).toBe(10);
			expect(new Set(hookOperations)).toEqual(new Set(ULW_LOOP_OPERATIONS));
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
