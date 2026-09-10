import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkpointUlwLoop } from "../src/checkpoint.js";
import { ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";
import { ulwLoopDir } from "../src/paths.js";
import { readUlwLoopPlan } from "../src/plan-io.js";
import { recordFinalReviewBlockers } from "../src/review-blockers.js";
import { UlwLoopError } from "../src/types.js";
import { goal, passGoal, plan, repoWith, snapshot } from "./fixtures/checkpoint-builders.js";

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
	it("#when checkpoint reconciles it #then the mismatch carries the verbatim expected and received objectives", async () => {
		const repo = await repoWith(plan([passGoal("G001"), goal({ id: "G002", status: "pending" })]));

		const error = await captureError(() =>
			checkpointUlwLoop(repo, {
				goalId: "G001",
				status: "complete",
				evidence: "work complete and validation passed",
				codexGoalJson: snapshot("active", "wrong objective"),
			}),
		);

		expect(error.code).toBe("ulw_loop_codex_snapshot_mismatch");
		expect(error.details).toMatchObject({
			expectedObjective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE,
			receivedObjective: "wrong objective",
		});
		expect(error.message).toContain(
			"objective must equal the plan's codexObjective exactly — copy the expected value below",
		);
		expect(error.message).toContain(ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE);
	});

	it("#when record-review-blockers reconciles it #then the same guided payload is emitted", async () => {
		const repo = await repoWith(
			plan([passGoal("G001", { status: "complete" }), goal({ id: "G002", status: "in_progress" })]),
		);

		const error = await captureError(() =>
			recordFinalReviewBlockers(repo, {
				goalId: "G002",
				title: "Resolve final review blockers",
				objective: "Address the BLOCK findings",
				evidence: "review verdict: REQUEST_CHANGES",
				codexGoalJson: JSON.stringify({ goal: { objective: "stale objective", status: "active" } }),
			}),
		);

		expect(error.code).toBe("ulw_loop_codex_snapshot_mismatch");
		expect(error.details).toMatchObject({
			expectedObjective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE,
			receivedObjective: "stale objective",
		});
		expect(error.message).toContain(
			"objective must equal the plan's codexObjective exactly — copy the expected value below",
		);
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
