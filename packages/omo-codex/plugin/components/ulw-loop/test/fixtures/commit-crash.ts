import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type UlwLoopScope, ulwLoopDir } from "../../src/paths.js";
import { createUlwLoopPlan } from "../../src/plan-crud.js";

export async function seedCrash(root: string, scope: UlwLoopScope, first: boolean) {
	const dir = ulwLoopDir(root, scope);
	const plan = await createUlwLoopPlan(root, { brief: "original" }, scope);
	const next = { ...plan, revision: (plan.revision ?? 0) + 1, brief: "committed\n", codexObjective: "committed" };
	mkdirSync(join(dir, "revisions"), { recursive: true });
	writeFileSync(
		join(dir, "revisions", `${String(next.revision).padStart(8, "0")}.json`),
		JSON.stringify({
			version: 1,
			revision: next.revision,
			plan: next,
			ledger: [{ at: "now", kind: "goal_added", revision: next.revision, id: `${next.revision}-0` }],
		}),
	);
	if (first) await rm(join(dir, "goals.json"));
	return next;
}
