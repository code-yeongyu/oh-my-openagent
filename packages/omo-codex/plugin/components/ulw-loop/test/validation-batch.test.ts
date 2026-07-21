import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createUlwLoopPlan } from "../src/plan-crud.js";
import { UlwLoopError } from "../src/types.js";

async function repo(): Promise<string> {
	return mkdtemp(join(tmpdir(), "ug-validation-batch-"));
}

describe("createUlwLoopPlan validation batches", () => {
	it("#given a valid validation batch #when creating goals #then stores it on the plan", async () => {
		const plan = await createUlwLoopPlan(await repo(), {
			brief: "- Goal alpha\n- Goal beta\n- Goal gamma",
			validationBatchesJson: '[{"batchId":"VB001","memberIds":["G001-goal-alpha","G002-goal-beta"],"finalGoalId":"G002-goal-beta"}]',
		});

		expect(plan.validationBatches).toEqual([
			{ batchId: "VB001", memberIds: ["G001-goal-alpha", "G002-goal-beta"], finalGoalId: "G002-goal-beta" },
		]);
	});

	it("#given an unknown member id #when creating goals #then rejects the batch", async () => {
		await expect(
			createUlwLoopPlan(await repo(), {
				brief: "- Goal alpha\n- Goal beta",
				validationBatchesJson: '[{"batchId":"VB001","memberIds":["G001-goal-alpha","missing"],"finalGoalId":"missing"}]',
			}),
		).rejects.toThrow(UlwLoopError);
	});

	it("#given a validation batch file #when creating goals #then reads the batch JSON from disk", async () => {
		const root = await repo();
		const file = join(root, "batches.json");
		await import("node:fs/promises").then((fs) => fs.writeFile(file, '[{"batchId":"VB001","memberIds":["G001-goal-alpha","G002-goal-beta"],"finalGoalId":"G002-goal-beta"}]', "utf8"));

		const plan = await createUlwLoopPlan(root, {
			brief: "- Goal alpha\n- Goal beta",
			validationBatchesJson: file,
		});

		expect(JSON.parse(await readFile(join(root, ".omo/ulw-loop/goals.json"), "utf8"))).toHaveProperty("validationBatches", plan.validationBatches);
	});
});
