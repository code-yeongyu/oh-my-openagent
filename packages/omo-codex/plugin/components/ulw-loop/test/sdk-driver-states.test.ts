import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readUlwLoopPlan } from "../src/plan-io.js";
import { createAgentToolkit } from "../src/sdk.js";

const workDirs: string[] = [];

afterEach(async () => {
	for (const dir of workDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Seeded {
	readonly cwd: string;
	readonly sessionId: string;
	readonly goalId: string;
	readonly objective: string;
}

// One fixture shape for every driver state: a real plan whose first goal is ready to close, so the
// only thing under test is what the driver snapshot does to the checkpoint.
async function seed(sessionId: string, brief = "- alpha goal\n- beta goal"): Promise<Seeded> {
	const cwd = await mkdtemp(join(tmpdir(), "ulw-driver-"));
	workDirs.push(cwd);
	const toolkit = createAgentToolkit({ cwd, sessionId, surface: "omo-senpi" });
	const created = await toolkit.createGoals({ brief });
	if (!created.ok) throw new Error("fixture could not create goals");
	return passNextGoal(cwd, sessionId);
}

async function passNextGoal(cwd: string, sessionId: string): Promise<Seeded> {
	const toolkit = createAgentToolkit({ cwd, sessionId, surface: "omo-senpi" });
	const started = await toolkit.completeGoals({});
	if (!started.ok || started.operation !== "complete-goals" || "done" in started.result)
		throw new Error("fixture could not start a goal");
	const goalId = started.result.goal.id;
	const criteria = await toolkit.criteria({ goalId });
	if (!criteria.ok || criteria.operation !== "criteria") throw new Error("fixture has no criteria");
	for (const criterion of criteria.result.criteria) {
		const recorded = await toolkit.recordEvidence({
			goalId,
			criterionId: criterion.id,
			status: "pass",
			evidence: "driver-state fixture proof",
		});
		if (!recorded.ok) throw new Error("fixture could not record evidence");
	}
	const plan = await readUlwLoopPlan(cwd, { sessionId });
	return { cwd, sessionId, goalId, objective: plan.codexObjective ?? "" };
}

function warningsOf(result: object): readonly string[] {
	return "warnings" in result && Array.isArray(result.warnings) ? result.warnings : [];
}

async function closeWith(seeded: Seeded, snapshot?: Record<string, unknown>) {
	const toolkit = createAgentToolkit({ cwd: seeded.cwd, sessionId: seeded.sessionId, surface: "omo-senpi" });
	return toolkit.checkpoint({
		goalId: seeded.goalId,
		status: "complete",
		evidence: "driver-state checkpoint",
		...(snapshot === undefined ? {} : { codexGoalJson: JSON.stringify(snapshot) }),
	});
}

describe("SDK driver-goal states", () => {
	describe("#given no driver snapshot", () => {
		it("#when the goal is checkpointed #then it completes and advises creating the driver goal", async () => {
			const seeded = await seed("driver-absent");

			const closed = await closeWith(seeded);

			expect(closed.ok).toBe(true);
			if (closed.ok) expect(closed.nextActions.join(" ")).toContain("create_goal");
		});
	});

	describe("#given an active driver carrying the plan objective", () => {
		it("#when the goal is checkpointed #then it completes with no objective difference reported", async () => {
			const seeded = await seed("driver-active");

			const closed = await closeWith(seeded, { goal: { objective: seeded.objective, status: "active" } });

			expect(closed.ok).toBe(true);
			if (closed.ok) {
				expect([...(closed.warnings ?? []), ...closed.nextActions].join(" ")).not.toContain(
					"driver_objective_differs",
				);
			}
		});
	});

	describe("#given a driver completed before the plan finished", () => {
		it("#when the goal is checkpointed #then it completes and advises re-creating the driver", async () => {
			const seeded = await seed("driver-early");

			const closed = await closeWith(seeded, { goal: { objective: seeded.objective, status: "complete" } });

			expect(closed.ok).toBe(true);
			if (closed.ok) expect(closed.nextActions.join(" ")).toContain("create_goal");
		});
	});

	describe("#given a driver the harness has limited", () => {
		for (const status of ["paused", "usage_limited", "budget_limited"] as const) {
			it(`#when the driver is ${status} #then the checkpoint still completes and advises resuming it`, async () => {
				const seeded = await seed(`driver-${status}`);

				const closed = await closeWith(seeded, { goal: { objective: seeded.objective, status } });

				expect(closed.ok).toBe(true);
				if (closed.ok) expect(closed.nextActions.join(" ")).toContain("/goal resume");
			});
		}
	});

	describe("#given a driver whose objective differs from the plan", () => {
		it("#when the goal is checkpointed #then the difference is a warning, never a rejection and never a next action", async () => {
			const seeded = await seed("driver-differs");

			const closed = await closeWith(seeded, { goal: { objective: "a different objective", status: "active" } });

			expect(closed.ok).toBe(true);
			if (closed.ok) {
				expect(warningsOf(closed.result).join(" ")).toContain("driver_objective_differs");
				expect(closed.nextActions.join(" ")).not.toContain("driver_objective_differs");
				expect(closed.nextActions.join(" ")).not.toContain("create_goal");
			}
		});

		it("#when a later goal is checkpointed under the same driver #then the difference is acknowledged in the plan and not repeated", async () => {
			const first = await seed("driver-differs-once", "- alpha goal\n- beta goal\n- gamma goal");
			const driver = { goal: { objective: "  a different\n objective  ", status: "active" } };

			const firstClose = await closeWith(first, driver);
			const second = await passNextGoal(first.cwd, first.sessionId);
			const secondClose = await closeWith(second, driver);

			expect(firstClose.ok && secondClose.ok).toBe(true);
			if (firstClose.ok && secondClose.ok) {
				expect(warningsOf(firstClose.result).join(" ")).toContain("driver_objective_differs");
				expect(warningsOf(secondClose.result)).toEqual([]);
				expect(secondClose.nextActions).toEqual([]);
			}
			const plan = await readUlwLoopPlan(first.cwd, { sessionId: first.sessionId });
			expect(plan.acknowledgedDriverObjectives).toEqual(["a different objective"]);
		});
	});

	describe("#given snapshot input that is neither JSON nor a readable path", () => {
		it("#when the goal is checkpointed #then the typed error is returned and the goal stays open", async () => {
			const seeded = await seed("driver-malformed");

			const closed = await closeWith(seeded);
			expect(closed.ok).toBe(true);

			const second = await seed("driver-malformed-2");
			const toolkit = createAgentToolkit({ cwd: second.cwd, sessionId: second.sessionId, surface: "omo-senpi" });
			const rejected = await toolkit.checkpoint({
				goalId: second.goalId,
				status: "complete",
				evidence: "driver-state checkpoint",
				codexGoalJson: "not json and not a path",
			});

			expect(rejected.ok).toBe(false);
			if (!rejected.ok) expect(rejected.error.code).toBe("ULW_LOOP_CODEX_GOAL_JSON_INVALID");
			const plan = await readUlwLoopPlan(second.cwd, { sessionId: second.sessionId });
			expect(plan.goals.find((goal) => goal.id === second.goalId)?.status).not.toBe("complete");
		});
	});
});
