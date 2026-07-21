import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readSteeringLedgerEntries, readUlwLoopPlan, writePlan } from "../src/plan-io.js";
import { steerUlwLoopBatch } from "../src/steering-batch.js";
import type { UlwLoopItem, UlwLoopPlan, UlwLoopSteeringProposal } from "../src/types.js";

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

	it("#given one invalid proposal #when applied as a batch #then no proposal mutates the plan", async () => {
		const repo = await repoWithPlan();

		const result = await steerUlwLoopBatch(repo, [proposal({ idempotencyKey: "ok" }), proposal({ kind: "reorder_pending", pendingOrder: ["missing"] })]);

		expect(result.accepted).toBe(false);
		expect((await readUlwLoopPlan(repo)).goals).toHaveLength(2);
		expect((await readSteeringLedgerEntries(repo)).filter((entry) => entry.kind === "steering_accepted")).toHaveLength(0);
	});

	it("#given a prior idempotency key #when batched with a fresh proposal #then dedupes one and applies the other", async () => {
		const repo = await repoWithPlan();
		await steerUlwLoopBatch(repo, [proposal({ idempotencyKey: "same" })]);

		const result = await steerUlwLoopBatch(repo, [proposal({ idempotencyKey: "same" }), proposal({ idempotencyKey: "fresh" })]);

		expect(result.accepted).toBe(true);
		expect(result.results.map((item) => item.deduped)).toEqual([true, false]);
		expect((await readUlwLoopPlan(repo)).goals).toHaveLength(4);
	});
});
