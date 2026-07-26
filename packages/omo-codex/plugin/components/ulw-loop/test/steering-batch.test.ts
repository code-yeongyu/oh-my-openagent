// biome-ignore-all format: compact steering batch tests stay under the pure LOC budget.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { CliSteeringProposal } from "../src/cli-steering.js";
import { readSteeringLedgerEntries, readUlwLoopPlan, writePlan } from "../src/plan-io.js";
import { steerUlwLoopBatch } from "../src/steering-batch.js";
import type { UlwLoopItem, UlwLoopPlan, UlwLoopSteeringProposal } from "../src/types.js";

const appendFileCalls = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	appendFileCalls.mockImplementation(actual.appendFile);
	return { ...actual, appendFile: appendFileCalls };
});

const NOW = "2026-05-23T00:00:00.000Z";

function goal(id: string): UlwLoopItem {
	return {
		id,
		title: id,
		objective: `Do ${id}`,
		status: "pending",
		successCriteria: [],
		attempt: 0,
		createdAt: NOW,
		updatedAt: NOW,
	};
}

function plan(): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		goals: [goal("G001"), goal("G002")],
	};
}

function proposal(overrides: Partial<UlwLoopSteeringProposal> = {}): UlwLoopSteeringProposal {
	return {
		kind: "add_subgoal",
		source: "cli",
		evidence: "observable evidence",
		rationale: "necessary plan refinement",
		title: "New goal",
		objective: "Do the new goal",
		...overrides,
	};
}

async function repoWithPlan(): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "ug-steer-batch-"));
	await writePlan(repo, plan());
	return repo;
}

describe("steerUlwLoopBatch", () => {
	it("#given two valid proposals #when applied as a batch #then both mutations commit", async () => {
		const repo = await repoWithPlan();

		const result = await steerUlwLoopBatch(repo, [
			proposal({ idempotencyKey: "b1" }),
			proposal({ kind: "revise_pending_wording", targetGoalId: "G001", revisedTitle: "Revised", idempotencyKey: "b2" }),
		]);

		expect(result.accepted).toBe(true);
		expect(result.results).toHaveLength(2);
		expect((await readUlwLoopPlan(repo)).goals.map((item) => item.title)).toContain("Revised");
		expect((await readSteeringLedgerEntries(repo)).filter((entry) => entry.kind === "steering_accepted")).toHaveLength(2);
	});

	it("#given rejected proposals #when applied as a batch #then one rejection audit lists every rejected index", async () => {
		const repo = await repoWithPlan();
		const before = JSON.stringify(await readUlwLoopPlan(repo));

		const result = await steerUlwLoopBatch(repo, [proposal({ idempotencyKey: "ok" }), proposal({ kind: "reorder_pending", pendingOrder: ["missing"] }), proposal({ evidence: "" })]);

		expect(result.accepted).toBe(false);
		expect(JSON.stringify(await readUlwLoopPlan(repo))).toBe(before);
		expect((await readUlwLoopPlan(repo)).goals).toHaveLength(2);
		const entries = await readSteeringLedgerEntries(repo);
		expect(entries.filter((entry) => entry.kind === "steering_accepted")).toHaveLength(0);
		expect(entries.filter((entry) => entry.kind === "steering_rejected")).toHaveLength(1);
		expect(entries.find((entry) => entry.kind === "steering_rejected")?.message).toContain("index 1:");
		expect(entries.find((entry) => entry.kind === "steering_rejected")?.message).toContain("index 2:");
	});

	it("#given a batch member split in proposals-json #when applied #then updates validation batch membership", async () => {
		const repo = await repoWithPlan();
		const seed = await readUlwLoopPlan(repo);
		await writePlan(repo, { ...seed, validationBatches: [{ batchId: "VB001", memberIds: ["G001", "G002"], finalGoalId: "G002" }] });

		const result = await steerUlwLoopBatch(repo, [
			proposal({
				kind: "split_subgoal",
				targetGoalId: "G001",
				childGoals: [{ title: "Child", objective: "Do child" }],
			}),
		]);

		expect(result.plan.validationBatches).toEqual([{ batchId: "VB001", memberIds: ["G003", "G002"], finalGoalId: "G002" }]);
		expect((await readSteeringLedgerEntries(repo)).at(-1)).toMatchObject({ kind: "batch_updated" });
	});

	it("#given a prior idempotency key #when batched with a fresh proposal #then dedupes one and applies the other", async () => {
		const repo = await repoWithPlan();
		await steerUlwLoopBatch(repo, [proposal({ idempotencyKey: "same" })]);

		const result = await steerUlwLoopBatch(repo, [proposal({ idempotencyKey: "same" }), proposal({ idempotencyKey: "fresh" })]);

		expect(result.accepted).toBe(true);
		expect(result.results.map((item) => item.deduped)).toEqual([true, false]);
		expect((await readUlwLoopPlan(repo)).goals).toHaveLength(4);
	});

	it("#given mixed fresh and deduped proposals #when accepted and replayed #then one append records all fresh audits and replay records none", async () => {
		const repo = await repoWithPlan();
		const seeded = await readUlwLoopPlan(repo);
		seeded.goals[0]?.successCriteria.push({ id: "C001", scenario: "old", expectedEvidence: "proof", userModel: "edge", status: "pending", capturedEvidence: null });
		await writePlan(repo, { ...seeded, validationBatches: [{ batchId: "VB001", memberIds: ["G001", "G002"], finalGoalId: "G002" }] });
		await steerUlwLoopBatch(repo, [proposal({ idempotencyKey: "dedupe-me" })]);
		appendFileCalls.mockClear();

		const revise = { ...proposal({ kind: "revise_criterion", targetGoalId: "G001", criterionId: "C001", idempotencyKey: "revise-c1" }), scenario: "new" } satisfies CliSteeringProposal;
		const batch = [
			proposal({ idempotencyKey: "dedupe-me" }),
			revise,
			proposal({ kind: "split_subgoal", targetGoalId: "G002", childGoals: [{ title: "Child", objective: "Do child" }], idempotencyKey: "split-g2" }),
		];
		const result = await steerUlwLoopBatch(repo, batch);

		expect(result.accepted).toBe(true);
		expect(result.results.map((item) => item.deduped)).toEqual([true, false, false]);
		expect(appendFileCalls).toHaveBeenCalledTimes(1);
		expect((await readSteeringLedgerEntries(repo)).map((entry) => entry.kind).slice(-3)).toEqual(["criteria_revised", "steering_accepted", "batch_updated"]);
		const after = JSON.stringify(await readUlwLoopPlan(repo));
		appendFileCalls.mockClear();

		const replay = await steerUlwLoopBatch(repo, batch);

		expect(replay.results.map((item) => item.deduped)).toEqual([true, true, true]);
		expect(JSON.stringify(await readUlwLoopPlan(repo))).toBe(after);
		expect(appendFileCalls).not.toHaveBeenCalled();
	});
});
