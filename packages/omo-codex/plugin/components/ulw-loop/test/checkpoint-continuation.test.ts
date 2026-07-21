import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { checkpointAndContinue } from "../src/checkpoint-continuation.js";
import { readUlwLoopPlan } from "../src/plan-io.js";
import { goal, plan, repoWith, snapshot } from "./fixtures/checkpoint-builders.js";

let repo: string | undefined;

afterEach(async () => {
	if (repo !== undefined) await rm(repo, { recursive: true, force: true });
	repo = undefined;
});

describe("checkpointAndContinue", () => {
	it("#given a completed non-final goal #when advance is enabled #then starts the next pending goal", async () => {
		repo = await repoWith(
			plan([
				goal({ id: "G001", status: "in_progress" }),
				goal({ id: "G002", status: "pending", attempt: 0 }),
			]),
		);

		const result = await checkpointAndContinue(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "implementation done and validation passed",
			codexGoalJson: snapshot("active"),
			advance: true,
		});

		expect(result.next).toMatchObject({ resumed: false, goal: { id: "G002", status: "in_progress" } });
		expect(result.next && "instruction" in result.next ? result.next.instruction.text : "").toContain("Goal: G002");
		expect((await readUlwLoopPlan(repo)).activeGoalId).toBe("G002");
	});

	it("#given advance disabled #when a non-final goal completes #then preserves the old two-call state", async () => {
		repo = await repoWith(
			plan([
				goal({ id: "G001", status: "in_progress" }),
				goal({ id: "G002", status: "pending", attempt: 0 }),
			]),
		);

		const result = await checkpointAndContinue(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "implementation done and validation passed",
			codexGoalJson: snapshot("active"),
			advance: false,
		});

		expect(result.next).toBeUndefined();
		expect((await readUlwLoopPlan(repo)).activeGoalId).toBeUndefined();
	});

	it("#given a failed checkpoint #when advance is enabled #then it does not start the next goal", async () => {
		repo = await repoWith(
			plan([
				goal({ id: "G001", status: "in_progress" }),
				goal({ id: "G002", status: "pending", attempt: 0 }),
			]),
		);

		const result = await checkpointAndContinue(repo, {
			goalId: "G001",
			status: "failed",
			evidence: "implementation failed and validation captured",
			advance: true,
		});

		expect(result.next).toBeUndefined();
		expect((await readUlwLoopPlan(repo)).activeGoalId).toBeUndefined();
	});
});
