import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ulwLoopDir } from "../src/paths.js";
import { readLedger, readUlwLoopPlan } from "../src/plan-io.js";
import { readNewestRecord } from "../src/plan-log.js";
import { createAgentToolkit } from "../src/sdk.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan } from "../src/types.js";
import { goal } from "./fixtures/checkpoint-builders.js";

// Reproduces #8328: a run created under the removed `omo_agent_toolkit` tool path published
// `revisions/00000004.json` while the plan held one goal, then kept mutating goals.json and appending
// ledger.jsonl lines DIRECTLY (no `revision`, no `id`) for goals the commit log never saw. The
// agent-toolkit-sdk runtime then rebuilt the projection from the snapshot and every later goal vanished.
const SESSION = "legacy-projection";
const LEGACY_AT = "2026-09-16T01:00:00.000Z";
let cwd: string;
let dir: string;
let legacyGoals: UlwLoopItem[];

function toolkit() {
	return createAgentToolkit({ cwd, sessionId: SESSION, surface: "omo-senpi" });
}
function ledgerLine(entry: UlwLoopLedgerEntry): string {
	return `${JSON.stringify(entry)}\n`;
}
function goalsOnDisk(): UlwLoopPlan {
	return JSON.parse(readFileSync(join(dir, "goals.json"), "utf8"));
}
async function seedSnapshotWithOneGoal(): Promise<void> {
	const created = await toolkit().createGoals({ brief: "- alpha goal" });
	if (!created.ok) throw new Error("fixture could not create goals");
	const started = await toolkit().completeGoals({});
	if (!started.ok || started.operation !== "complete-goals" || "done" in started.result)
		throw new Error("fixture could not start alpha");
	const goalId = started.result.goal.id;
	const criteria = await toolkit().criteria({ goalId });
	if (!criteria.ok || criteria.operation !== "criteria") throw new Error("fixture has no criteria");
	// Two evidence captures on alpha -> revisions 3 and 4; the snapshot under test is 00000004.json.
	for (const criterion of criteria.result.criteria.slice(0, 2)) {
		const recorded = await toolkit().recordEvidence({
			goalId,
			criterionId: criterion.id,
			status: "pass",
			evidence: "alpha proof",
		});
		if (!recorded.ok) throw new Error("fixture could not record alpha evidence");
	}
}
// The removed tool path rewrote goals.json wholesale (never stamping `revision`) and appended raw
// ledger lines; this is that write, byte-shape included.
function appendLegacyGoals(): void {
	const plan = goalsOnDisk();
	delete plan.revision;
	legacyGoals = [
		goal({
			id: "G002-legacy-done",
			title: "legacy done",
			status: "complete",
			completedAt: LEGACY_AT,
			evidence: "legacy done proof",
		}),
		goal({ id: "G003-legacy-active", title: "legacy active", status: "in_progress", startedAt: LEGACY_AT }),
		goal({ id: "G004-legacy-pending", title: "legacy pending", status: "pending", attempt: 0, successCriteria: [] }),
	];
	plan.goals.push(...legacyGoals);
	plan.activeGoalId = "G003-legacy-active";
	plan.updatedAt = LEGACY_AT;
	writeFileSync(join(dir, "goals.json"), `${JSON.stringify(plan, null, 2)}\n`);
	const entries: UlwLoopLedgerEntry[] = [
		...legacyGoals.map((item) => ({
			at: LEGACY_AT,
			kind: "goal_added" as const,
			goalId: item.id,
			status: item.status,
			message: item.title,
		})),
		{ at: LEGACY_AT, kind: "goal_started", goalId: "G002-legacy-done", status: "in_progress", message: "Attempt 1" },
		{
			at: LEGACY_AT,
			kind: "evidence_captured",
			goalId: "G002-legacy-done",
			criterionId: "C001",
			criterionStatus: "pass",
			evidence: "C001 passed",
		},
		{
			at: LEGACY_AT,
			kind: "goal_completed",
			goalId: "G002-legacy-done",
			status: "complete",
			evidence: "legacy done proof",
		},
		{
			at: LEGACY_AT,
			kind: "goal_started",
			goalId: "G003-legacy-active",
			status: "in_progress",
			message: "Attempt 1",
		},
		{
			at: LEGACY_AT,
			kind: "evidence_captured",
			goalId: "G003-legacy-active",
			criterionId: "C001",
			criterionStatus: "pass",
			evidence: "C001 passed",
		},
	];
	appendFileSync(join(dir, "ledger.jsonl"), entries.map(ledgerLine).join(""));
}

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "ulw-legacy-projection-"));
	dir = ulwLoopDir(cwd, { sessionId: SESSION });
	await seedSnapshotWithOneGoal();
	expect(readNewestRecord(dir)?.revision).toBe(4);
	expect(readNewestRecord(dir)?.plan.goals).toHaveLength(1);
	appendLegacyGoals();
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("#given snapshot 4 holds one goal and the legacy tool path appended three goals with evidence afterwards", () => {
	it("#when status rebuilds the projection #then every legacy goal, its evidence and its ledger events survive", async () => {
		const status = await toolkit().status();

		expect(status.ok).toBe(true);
		if (!status.ok || status.operation !== "status") return;
		expect(status.result.plan.goals.map((item) => item.id)).toEqual([
			"G001-alpha-goal",
			"G002-legacy-done",
			"G003-legacy-active",
			"G004-legacy-pending",
		]);
		const done = status.result.plan.goals.find((item) => item.id === "G002-legacy-done");
		expect(done?.status).toBe("complete");
		expect(done?.successCriteria.map((criterion) => criterion.capturedEvidence)).toEqual([
			"C001 passed",
			"C002 passed",
			"C003 passed",
		]);
		expect(status.result.plan.activeGoalId).toBe("G003-legacy-active");
		const ledger = readLedger(cwd, { sessionId: SESSION });
		expect(ledger.filter((entry) => entry.kind === "goal_added").map((entry) => entry.goalId)).toEqual(
			legacyGoals.map((item) => item.id),
		);
		expect(ledger.filter((entry) => entry.goalId === "G002-legacy-done").map((entry) => entry.kind)).toEqual([
			"goal_added",
			"goal_started",
			"evidence_captured",
			"goal_completed",
		]);
	});

	it("#when evidence is recorded on a legacy goal #then it succeeds and publishes revision 5 holding all four goals", async () => {
		const recorded = await toolkit().recordEvidence({
			goalId: "G003-legacy-active",
			criterionId: "C002",
			status: "pass",
			evidence: "recorded after the runtime switch",
		});

		expect(recorded.ok).toBe(true);
		if (!recorded.ok) return;
		const newest = readNewestRecord(dir);
		expect(newest?.revision).toBe(5);
		expect(existsSync(join(dir, "revisions", "00000005.json"))).toBe(true);
		expect(newest?.plan.goals.map((item) => item.id)).toEqual([
			"G001-alpha-goal",
			"G002-legacy-done",
			"G003-legacy-active",
			"G004-legacy-pending",
		]);
		expect(newest?.plan.revision).toBe(5);
		expect(goalsOnDisk().revision).toBe(5);
		expect(goalsOnDisk().goals).toHaveLength(4);
		// The legacy audit trail is still part of the reconciled ledger after the fold.
		expect(
			readLedger(cwd, { sessionId: SESSION }).some(
				(entry) => entry.kind === "goal_completed" && entry.goalId === "G002-legacy-done",
			),
		).toBe(true);
	});

	it("#when a legacy goal is checkpointed complete #then the checkpoint succeeds and the next legacy goal is still there", async () => {
		const closed = await toolkit().checkpoint({
			goalId: "G003-legacy-active",
			status: "complete",
			evidence: "legacy goal closed after the runtime switch",
		});

		expect(closed.ok).toBe(true);
		if (!closed.ok) return;
		const plan = await readUlwLoopPlan(cwd, { sessionId: SESSION });
		expect(plan.goals.find((item) => item.id === "G003-legacy-active")?.status).toBe("complete");
		expect(plan.goals.find((item) => item.id === "G004-legacy-pending")?.status).toBe("pending");
		expect(plan.goals).toHaveLength(4);
	});
});

describe("#given the projection has already been truncated below what the ledger records", () => {
	it("#when a locked operation would rewrite goals.json #then it refuses with ULW_LOOP_PROJECTION_TRUNCATED instead of dropping goals", async () => {
		// The pre-fix runtime already rewrote goals.json from the one-goal snapshot; only ledger.jsonl still
		// names the legacy goals.
		const truncated = readNewestRecord(dir);
		if (truncated === undefined) throw new Error("fixture lost its snapshot");
		writeFileSync(join(dir, "goals.json"), `${JSON.stringify(truncated.plan, null, 2)}\n`);
		const before = readFileSync(join(dir, "goals.json"), "utf8");

		const recorded = await toolkit().recordEvidence({
			goalId: "G001-alpha-goal",
			criterionId: "C003",
			status: "pass",
			evidence: "must not be accepted on a truncated projection",
		});

		expect(recorded.ok).toBe(false);
		if (recorded.ok) return;
		expect(recorded.error.code).toBe("ULW_LOOP_PROJECTION_TRUNCATED");
		expect(recorded.error.message).toContain("G002-legacy-done");
		expect(readFileSync(join(dir, "goals.json"), "utf8")).toBe(before);
		expect(readNewestRecord(dir)?.revision).toBe(4);
	});
});
