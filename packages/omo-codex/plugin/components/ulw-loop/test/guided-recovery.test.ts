import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkpointUlwLoop } from "../src/checkpoint.js";
import { ulwLoopDir } from "../src/paths.js";
import { readUlwLoopPlan } from "../src/plan-io.js";
import { UlwLoopError } from "../src/types.js";
import { goal, passGoal, plan, repoWith } from "./fixtures/checkpoint-builders.js";

async function captureError(action: () => Promise<unknown>): Promise<UlwLoopError> {
	try {
		await action();
	} catch (error) {
		expect(error).toBeInstanceOf(UlwLoopError);
		if (error instanceof UlwLoopError) return error;
		throw error;
	}
	throw new Error("Expected UlwLoopError");
}

describe("#given a codex goal snapshot whose objective differs from the plan", () => {
	it("#when checkpoint reconciles it #then it succeeds with driver advice", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));
		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "work complete",
			codexGoalJson: JSON.stringify({ goal: { objective: "wrong objective", status: "budget_limited" } }),
		});
		expect(result.nextActions.join(" ")).toContain("/goal resume");
		expect(result.warnings.join(" ")).toContain("driver_objective_differs");
	});
});

describe("#given no ulw-loop plan on disk", () => {
	it("#when the plan is read #then the error names the exact create-goals bootstrap command", async () => {
		const repo = await mkdtemp(join(tmpdir(), "ug-guided-plan-"));

		const error = await captureError(() => readUlwLoopPlan(repo));

		expect(error.code).toBe("ULW_LOOP_PLAN_MISSING");
		expect(error.message).toContain('omo-agent-toolkit ulw-loop create-goals --brief "<brief>" --json');
	});

	it("#when sibling session dirs exist #then the error lists the existing session ids", async () => {
		const repo = await mkdtemp(join(tmpdir(), "ug-guided-plan-"));
		await mkdir(join(ulwLoopDir(repo), "session-alpha"), { recursive: true });
		await mkdir(join(ulwLoopDir(repo), "session-beta"), { recursive: true });

		const error = await captureError(() => readUlwLoopPlan(repo, { sessionId: "session-gamma" }));

		expect(error.code).toBe("ULW_LOOP_PLAN_MISSING");
		expect(error.message).toContain("session-alpha");
		expect(error.message).toContain("session-beta");
		expect(error.details).toMatchObject({ existingSessionIds: ["session-alpha", "session-beta"] });
	});

	it("#when no session dirs exist #then the error lists no session ids", async () => {
		const repo = await mkdtemp(join(tmpdir(), "ug-guided-plan-"));

		const error = await captureError(() => readUlwLoopPlan(repo, { sessionId: "session-gamma" }));

		expect(error.details?.["existingSessionIds"]).toBeUndefined();
	});
});
