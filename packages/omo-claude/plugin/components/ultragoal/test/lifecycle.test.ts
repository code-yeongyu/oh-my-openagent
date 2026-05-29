import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { makeUltragoalScope } from "../src/session-scope.js";
import { createUltragoalPlan, startNextUltragoal } from "../src/plan-crud.js";
import { checkpointUltragoal } from "../src/checkpoint.js";
import { recordEvidence } from "../src/evidence.js";
import { steerUltragoal } from "../src/steering.js";
import { buildGoalInstruction } from "../src/goal-instruction.js";
import { readUltragoalPlan } from "../src/plan-io.js";
import { ultragoalLedgerPath } from "../src/paths.js";

const BRIEF = "- Implement the alpha feature\n- Implement the beta feature\n";

async function tmpRepo(): Promise<string> {
	return mkdtemp(join(tmpdir(), "ug-life-"));
}

describe("scope-threaded lifecycle still works end-to-end", () => {
	it("create -> complete-goals handoff -> record-evidence -> checkpoint (per_story)", async () => {
		const repoRoot = await tmpRepo();
		const scope = makeUltragoalScope(repoRoot, "life-1");
		const plan = await createUltragoalPlan(scope, { brief: BRIEF, goalMode: "per_story" });
		expect(plan.goals.length).toBe(2);

		const started = await startNextUltragoal(scope, {});
		expect("goal" in started).toBe(true);
		if (!("goal" in started)) throw new Error("expected a goal");
		const goal = started.goal;

		// handoff text is file/steering based, no create_goal/get_goal language.
		const instruction = buildGoalInstruction({ plan: started.plan, goal });
		expect(instruction.text).not.toContain("create_goal");
		expect(instruction.text).not.toContain("get_goal");
		expect(instruction.text).toContain(started.plan.goalsPath);

		// pass all seeded criteria
		for (const c of goal.successCriteria) {
			await recordEvidence(scope, { goalId: goal.id, criterionId: c.id, status: "pass", evidence: "verified ok" });
		}
		// checkpoint complete WITHOUT a goal snapshot (snapshot is optional now)
		const result = await checkpointUltragoal(scope, {
			goalId: goal.id,
			status: "complete",
			evidence: "alpha done; tests pass; review clean",
		});
		expect(result.goal.status).toBe("complete");

		const reread = await readUltragoalPlan(scope);
		expect(reread.goals.find((g) => g.id === goal.id)?.status).toBe("complete");
	});

	it("steering adds a subgoal and is written under the session scope", async () => {
		const repoRoot = await tmpRepo();
		const scope = makeUltragoalScope(repoRoot, "life-2");
		await createUltragoalPlan(scope, { brief: BRIEF });
		const result = await steerUltragoal(scope, {
			kind: "add_subgoal",
			source: "cli",
			title: "Gamma feature",
			objective: "Implement the gamma feature with care",
			evidence: "user asked for gamma",
			rationale: "newly discovered requirement",
		});
		expect(result.accepted).toBe(true);
		const reread = await readUltragoalPlan(scope);
		expect(reread.goals.some((g) => g.title === "Gamma feature")).toBe(true);
		// ledger lives in the session scope
		const ledger = await readFile(ultragoalLedgerPath(scope), "utf8");
		expect(ledger).toContain("steering_accepted");
	});

	it("steering is a no-op when the plan is missing for the scope", async () => {
		const repoRoot = await tmpRepo();
		const scope = makeUltragoalScope(repoRoot, "life-noplan");
		await expect(
			steerUltragoal(scope, {
				kind: "annotate_ledger",
				source: "cli",
				evidence: "x",
				rationale: "y",
			}),
		).rejects.toThrow();
	});
});
