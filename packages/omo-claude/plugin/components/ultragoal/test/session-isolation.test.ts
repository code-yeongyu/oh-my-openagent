import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { makeUltragoalScope } from "../src/session-scope.js";
import { createUltragoalPlan } from "../src/plan-crud.js";
import { readUltragoalPlan, writePlan, readUltragoalIndex } from "../src/plan-io.js";
import { ultragoalGoalsPath, ultragoalSessionDir, ultragoalIndexPath, legacyUltragoalGoalsPath } from "../src/paths.js";

const BRIEF = "- First goal objective for testing\n- Second goal objective for testing\n";

async function tmpRepo(): Promise<string> {
	return mkdtemp(join(tmpdir(), "ug-session-"));
}

describe("per-session isolation", () => {
	it("two distinct session ids produce two isolated plans under sessions/claude-*/", async () => {
		const repoRoot = await tmpRepo();
		const scopeA = makeUltragoalScope(repoRoot, "session-aaa");
		const scopeB = makeUltragoalScope(repoRoot, "session-bbb");

		await createUltragoalPlan(scopeA, { brief: BRIEF });
		await createUltragoalPlan(scopeB, { brief: BRIEF });

		expect(existsSync(ultragoalGoalsPath(scopeA))).toBe(true);
		expect(existsSync(ultragoalGoalsPath(scopeB))).toBe(true);
		expect(ultragoalSessionDir(scopeA)).toContain("claude-session-aaa");
		expect(ultragoalSessionDir(scopeB)).toContain("claude-session-bbb");
		expect(ultragoalGoalsPath(scopeA)).not.toBe(ultragoalGoalsPath(scopeB));

		// goal content lives under ./.omo/ultragoal/sessions/
		expect(ultragoalSessionDir(scopeA)).toContain(join(".omo", "ultragoal", "sessions"));
	});

	it("registers both sessions in the index.json registry", async () => {
		const repoRoot = await tmpRepo();
		const scopeA = makeUltragoalScope(repoRoot, "idx-aaa");
		const scopeB = makeUltragoalScope(repoRoot, "idx-bbb");
		await createUltragoalPlan(scopeA, { brief: BRIEF });
		await createUltragoalPlan(scopeB, { brief: BRIEF });

		expect(existsSync(ultragoalIndexPath(repoRoot))).toBe(true);
		const index = await readUltragoalIndex(repoRoot);
		const ids = index.sessions.map((s) => s.sessionId);
		expect(ids).toContain("claude:idx-aaa");
		expect(ids).toContain("claude:idx-bbb");
	});

	it("writes version:2 plans with platform/sessionId/sessionScope", async () => {
		const repoRoot = await tmpRepo();
		const scope = makeUltragoalScope(repoRoot, "v2-check");
		const plan = await createUltragoalPlan(scope, { brief: BRIEF });
		expect(plan.version).toBe(2);
		expect(plan.platform).toBe("claude");
		expect(plan.sessionId).toBe("claude:v2-check");
		const reread = await readUltragoalPlan(scope);
		expect(reread.version).toBe(2);
		expect(reread.goals.length).toBe(2);
	});
});

describe("v1 -> v2 migration", () => {
	it("reads a legacy v1 plan, migrates it forward, and does NOT delete the v1 file", async () => {
		const repoRoot = await tmpRepo();
		const scope = makeUltragoalScope(repoRoot, "legacy-1");

		// Author a legacy v1 plan at the OLD repo-level path.
		const legacyPath = legacyUltragoalGoalsPath(repoRoot);
		await mkdir(join(repoRoot, ".omo", "ultragoal"), { recursive: true });
		const v1Plan = {
			version: 1,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			briefPath: ".omo/ultragoal/brief.md",
			goalsPath: ".omo/ultragoal/goals.json",
			ledgerPath: ".omo/ultragoal/ledger.jsonl",
			codexGoalMode: "aggregate",
			goals: [
				{
					id: "G001",
					title: "Legacy goal",
					objective: "Do the legacy thing.",
					status: "pending",
					successCriteria: [],
					attempt: 0,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		await writeFile(legacyPath, `${JSON.stringify(v1Plan, null, 2)}\n`, "utf8");

		const migrated = await readUltragoalPlan(scope);
		expect(migrated.version).toBe(2);
		expect(migrated.goals[0]?.id).toBe("G001");
		expect(migrated.goalMode).toBe("aggregate");

		// The legacy v1 file must still exist (read-only migration).
		expect(existsSync(legacyPath)).toBe(true);
		const stillV1 = JSON.parse(await readFile(legacyPath, "utf8"));
		expect(stillV1.version).toBe(1);

		// And the migrated copy lives in the session scope dir.
		expect(existsSync(ultragoalGoalsPath(scope))).toBe(true);
	});
});
