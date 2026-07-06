import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { accountGoalUsage, clearGoal, createGoal, goalFilePath, readGoal, updateGoal } from "../src/goal/store.js";
import type { GoalStoreRef } from "../src/goal/types.js";

const tempDirs: string[] = [];

describe("goal store", () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("creates a persisted active goal", async () => {
		const ref = await tempStore("thread-create");
		const goal = await createGoal(ref, "  Ship the extension  ", 10_000);

		expect(goal.threadId).toBe("thread-create");
		expect(goal.objective).toBe("Ship the extension");
		expect(goal.status).toBe("active");
		expect(goal.tokenBudget).toBe(10_000);
		expect(await readGoal(ref)).toMatchObject({ id: goal.id, objective: "Ship the extension" });
		// Normalize separators so the path assertion holds on Windows (backslashes) too.
		expect(goalFilePath(ref).replaceAll("\\", "/")).toContain("extensions/pi-goal/thread-create.json");
		expect(goalFilePath(ref)).not.toContain(".pi");
		expect(await readFile(goalFilePath(ref), "utf8")).toContain('"version": 1');
	});

	it("does not replace an existing goal when createGoal is called again", async () => {
		const ref = await tempStore("thread-duplicate-create");
		const original = await createGoal(ref, "Original", 10_000);

		await expect(createGoal(ref, "Replacement", 20_000)).rejects.toThrow(
			"cannot create a new goal because this thread has an unfinished goal; complete the existing goal first",
		);

		expect(await readGoal(ref)).toMatchObject({
			id: original.id,
			objective: "Original",
			tokenBudget: 10_000,
		});
	});

	it("replaces changed objectives and preserves usage for status updates", async () => {
		const ref = await tempStore();
		const first = await createGoal(ref, "Original");
		await accountGoalUsage(ref, { input: 23, output: 2, cacheRead: 0, cacheWrite: 4, totalTokens: 25 }, 70);

		const paused = await updateGoal(ref, { status: "paused" });
		expect(paused.id).toBe(first.id);
		expect(paused.tokensUsed).toBe(25);
		expect(paused.timeUsedSeconds).toBe(70);

		const replaced = await updateGoal(ref, { objective: "Replacement" });
		expect(replaced.id).not.toBe(first.id);
		expect(replaced.tokensUsed).toBe(0);
		expect(replaced.timeUsedSeconds).toBe(0);
		expect(replaced.status).toBe("active");
	});

	it("resumes a matching nonterminal goal when the objective is set again", async () => {
		const ref = await tempStore();
		const first = await createGoal(ref, "Same");
		const paused = await updateGoal(ref, { status: "paused" });

		const resumed = await updateGoal(ref, { objective: "Same" });

		expect(paused.id).toBe(first.id);
		expect(resumed.id).toBe(first.id);
		expect(resumed.status).toBe("active");
	});

	it("counts Pi non-cached input plus output tokens like Codex", async () => {
		const ref = await tempStore();
		await createGoal(ref, "Budgeted");

		const goal = await accountGoalUsage(
			ref,
			{ input: 100, output: 20, cacheRead: 70, cacheWrite: 0, totalTokens: 999 },
			0,
		);

		expect(goal).toMatchObject({ tokensUsed: 120 });
	});

	it("marks active goals budgetLimited when accounting reaches budget", async () => {
		const ref = await tempStore();
		await createGoal(ref, "Budgeted", 50);

		const goal = await accountGoalUsage(
			ref,
			{ input: 31, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 51 },
			4,
		);

		expect(goal).toMatchObject({ status: "budgetLimited", tokensUsed: 51, timeUsedSeconds: 4 });
	});

	it("continues accounting budget-limited goals for in-flight active usage", async () => {
		const ref = await tempStore();
		await createGoal(ref, "Budgeted", 20);
		await accountGoalUsage(ref, { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 5 }, 7);
		await accountGoalUsage(ref, { input: 15, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 15 }, 3);

		const goal = await accountGoalUsage(
			ref,
			{ input: 5, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 5 },
			5,
			"active",
		);

		expect(goal).toMatchObject({ status: "budgetLimited", tokensUsed: 25, timeUsedSeconds: 15 });
	});

	it("keeps budget-limited goals terminal when paused or reactivated over budget", async () => {
		const ref = await tempStore();
		await createGoal(ref, "Budgeted", 20);
		await accountGoalUsage(ref, { input: 25, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 25 }, 1);

		const paused = await updateGoal(ref, { status: "paused" });
		expect(paused).toMatchObject({ status: "budgetLimited", tokensUsed: 25, tokenBudget: 20 });

		const reactivated = await updateGoal(ref, { status: "active" });
		expect(reactivated).toMatchObject({ status: "budgetLimited", tokensUsed: 25, tokenBudget: 20 });
	});

	it("immediately budget-limits active goals when a lowered budget is already exceeded", async () => {
		const ref = await tempStore();
		await createGoal(ref, "Budgeted", 100);
		await accountGoalUsage(ref, { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 50 }, 1);

		const lowered = await updateGoal(ref, { tokenBudget: 40 });

		expect(lowered).toMatchObject({ status: "budgetLimited", tokensUsed: 50, tokenBudget: 40 });
	});

	it("can finalize paused in-flight usage and promote stopped goals over budget", async () => {
		const ref = await tempStore();
		await createGoal(ref, "Stopped", 20);
		await updateGoal(ref, { status: "paused" });

		const activeOnly = await accountGoalUsage(
			ref,
			{ input: 25, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 25 },
			3,
			"active",
		);
		expect(activeOnly).toMatchObject({ status: "paused", tokensUsed: 0, timeUsedSeconds: 0 });

		const stopped = await accountGoalUsage(
			ref,
			{ input: 25, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 25 },
			3,
			"activeOrStopped",
		);
		expect(stopped).toMatchObject({ status: "budgetLimited", tokensUsed: 25, timeUsedSeconds: 3 });
	});

	it("clears the store while preserving the versioned file", async () => {
		const ref = await tempStore();
		await createGoal(ref, "Temporary");

		expect(await clearGoal(ref)).toBe(true);
		expect(await readGoal(ref)).toBeNull();
	});
});

async function tempStore(threadId = "thread-test"): Promise<GoalStoreRef> {
	const dir = await mkdtemp(join(tmpdir(), "pi-goal-"));
	tempDirs.push(dir);
	return { baseDir: join(dir, "extensions", "pi-goal"), threadId };
}
