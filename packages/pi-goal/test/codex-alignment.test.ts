import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { accountGoalUsage, createGoal, readGoal, updateGoal } from "../src/goal/store.js";
import type { TokenUsageSnapshot } from "../src/goal/types.js";
import type { GoalStoreRef } from "../src/goal/types.js";
import { GOAL_STATUS_VALUES } from "../src/goal/types.js";

const tempDirs: string[] = [];

async function tempStore(threadId: string): Promise<GoalStoreRef> {
	const dir = await mkdtemp(join(tmpdir(), "pi-goal-codex-"));
	tempDirs.push(dir);
	return { baseDir: dir, threadId };
}

describe("codex alignment: blocked status", () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("includes blocked in the goal status vocabulary", () => {
		expect(GOAL_STATUS_VALUES).toContain("blocked");
	});

	it("marks an active goal blocked and clears its lastStartedAt", async () => {
		const ref = await tempStore("thread-block");
		await createGoal(ref, "Pursue the objective");

		const blocked = await updateGoal(ref, { status: "blocked" });

		expect(blocked.status).toBe("blocked");
		expect(blocked.lastStartedAt).toBeUndefined();
		expect((await readGoal(ref))?.status).toBe("blocked");
	});

	it("preserves budgetLimited when a blocked update is requested", async () => {
		const ref = await tempStore("thread-block-budget");
		await createGoal(ref, "Budget goal", 10);
		const overBudget: TokenUsageSnapshot = { input: 20, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 20 };
		const limited = await accountGoalUsage(ref, overBudget, 0, "active");
		expect(limited?.status).toBe("budgetLimited");

		const afterBlock = await updateGoal(ref, { status: "blocked" });

		expect(afterBlock.status).toBe("budgetLimited");
	});
});

describe("codex alignment: create replaces only a complete goal", () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("replaces a completed goal with a fresh active goal", async () => {
		const ref = await tempStore("thread-replace-complete");
		const first = await createGoal(ref, "First objective");
		await updateGoal(ref, { status: "complete" });

		const replacement = await createGoal(ref, "Second objective");

		expect(replacement.status).toBe("active");
		expect(replacement.objective).toBe("Second objective");
		expect(replacement.id).not.toBe(first.id);
		expect(replacement.tokensUsed).toBe(0);
	});

	it("rejects creating a goal while an unfinished goal exists with the codex message", async () => {
		const ref = await tempStore("thread-unfinished");
		await createGoal(ref, "Active objective");

		await expect(createGoal(ref, "Another objective")).rejects.toThrow(
			"cannot create a new goal because this thread has an unfinished goal; complete the existing goal first",
		);
	});

	it("rejects creating a goal while a blocked goal exists", async () => {
		const ref = await tempStore("thread-blocked-exists");
		await createGoal(ref, "Blocked objective");
		await updateGoal(ref, { status: "blocked" });

		await expect(createGoal(ref, "New objective")).rejects.toThrow("has an unfinished goal");
	});
});
