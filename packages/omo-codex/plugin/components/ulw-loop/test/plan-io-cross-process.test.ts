import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UlwLoopPlan } from "../src/types.ts";

type EvidenceModule = typeof import("../src/evidence.ts");

const NOW = "2026-09-07T00:00:00.000Z";
const SCOPE = { sessionId: "s1" } as const;
const CRITERIA = ["C001", "C002", "C003"] as const;

let repoRoot: string;

beforeEach(async () => {
	repoRoot = await mkdtemp(join(tmpdir(), "ulw-cross-process-"));
	await mkdir(join(repoRoot, ".omo", "ulw-loop", "s1"), { recursive: true });
	await writeFile(join(repoRoot, ".omo", "ulw-loop", "s1", "goals.json"), `${JSON.stringify(plan(), null, 2)}\n`);
	await writeFile(join(repoRoot, ".omo", "ulw-loop", "s1", "ledger.jsonl"), "");
});

afterEach(async () => {
	vi.resetModules();
	await rm(repoRoot, { recursive: true, force: true });
});

function plan(): UlwLoopPlan {
	return {
		version: 1,
		evidenceLayoutVersion: 2,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/s1/brief.md",
		goalsPath: ".omo/ulw-loop/s1/goals.json",
		ledgerPath: ".omo/ulw-loop/s1/ledger.jsonl",
		codexGoalMode: "aggregate",
		activeGoalId: "G001",
		goals: [
			{
				id: "G001",
				title: "Goal one",
				objective: "Goal one",
				status: "in_progress",
				attempt: 1,
				createdAt: NOW,
				updatedAt: NOW,
				successCriteria: CRITERIA.map((id) => ({
					id,
					scenario: `scenario ${id}`,
					userModel: "happy",
					expectedEvidence: "evidence",
					essential: true,
					capturedEvidence: null,
					status: "pending",
				})),
			},
		],
	};
}

// Each isolated import evaluates plan-io again, so every instance owns a fresh
// in-process promise chain: the same situation as separate CLI processes
// sharing one state directory.
async function loadIsolatedEvidenceModule(): Promise<EvidenceModule> {
	vi.resetModules();
	return await import("../src/evidence.ts");
}

async function readPlanFile(): Promise<UlwLoopPlan> {
	return JSON.parse(await readFile(join(repoRoot, ".omo", "ulw-loop", "s1", "goals.json"), "utf8"));
}

async function readLedgerKinds(): Promise<readonly string[]> {
	const raw = await readFile(join(repoRoot, ".omo", "ulw-loop", "s1", "ledger.jsonl"), "utf8");
	return raw
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line).kind);
}

describe("record-evidence across independent module instances", () => {
	describe("#given three evidence writers that share only the state directory", () => {
		it("#when they record different criteria concurrently #then every criterion lands in goals.json", async () => {
			const writers: { readonly criterionId: string; readonly module: EvidenceModule }[] = [];
			for (const criterionId of CRITERIA) {
				writers.push({ criterionId, module: await loadIsolatedEvidenceModule() });
			}

			await Promise.all(
				writers.map(({ criterionId, module }) =>
					module.recordEvidence(
						repoRoot,
						{ goalId: "G001", criterionId, status: "pass", evidence: `proof ${criterionId}` },
						SCOPE,
					),
				),
			);

			const persisted = await readPlanFile();
			const statuses = persisted.goals[0]?.successCriteria.map((criterion) => criterion.status);
			expect(statuses).toEqual(["pass", "pass", "pass"]);
			expect(await readLedgerKinds()).toEqual(["evidence_captured", "evidence_captured", "evidence_captured"]);
		});
	});
});
