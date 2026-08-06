import { appendFile, copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { ulwLoopDir, ulwLoopGoalsPath, ulwLoopLedgerPath } from "../src/paths.js";
import {
	appendLedger,
	findAcceptedSteeringLedgerEntry,
	readSteeringLedgerEntries,
	readUlwLoopPlan,
	withUlwLoopMutationLock,
	writePlan,
} from "../src/plan-io.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan, UlwLoopSteeringAudit } from "../src/types.js";
import { UlwLoopError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";
const STABLE_OBJECTIVE =
	"Complete the durable ulw-loop plan in .omo/ulw-loop/goals.json, including later accepted/appended stories, under the original brief constraints; use .omo/ulw-loop/ledger.jsonl as the audit trail.";

function makeGoal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id: "G001",
		title: "Build auth service",
		objective: "Implement JWT auth endpoint",
		status: "pending",
		successCriteria: [],
		attempt: 1,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function makePlan(overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		codexGoalMode: "aggregate",
		codexObjective: STABLE_OBJECTIVE,
		codexObjectiveAliases: [],
		goals: [makeGoal()],
		...overrides,
	};
}

function entry(kind: UlwLoopLedgerEntry["kind"], goalId = "G001"): UlwLoopLedgerEntry {
	return { at: NOW, kind, goalId };
}

function steeringAudit(overrides: Partial<UlwLoopSteeringAudit> = {}): UlwLoopSteeringAudit {
	return {
		kind: "revise_pending_wording",
		source: "cli",
		targetGoalIds: ["G001"],
		evidence: "observed evidence",
		rationale: "needed change",
		invariant: {
			accepted: true,
			structuralInvariantAccepted: true,
			evidenceBackedNecessity: true,
			noEasierCompletion: true,
			rejectedReasons: [],
		},
		...overrides,
	};
}

function rejectedSteeringAudit(overrides: Partial<UlwLoopSteeringAudit> = {}): UlwLoopSteeringAudit {
	return steeringAudit({
		invariant: {
			accepted: false,
			structuralInvariantAccepted: false,
			evidenceBackedNecessity: false,
			noEasierCompletion: true,
			rejectedReasons: ["missing evidence"],
		},
		...overrides,
	});
}

function steeringEntry(
	kind: UlwLoopLedgerEntry["kind"],
	audit: UlwLoopSteeringAudit,
	overrides: Partial<UlwLoopLedgerEntry> = {},
): UlwLoopLedgerEntry {
	return { at: NOW, kind, goalId: "G001", steering: audit, ...overrides };
}

async function makeRepo(): Promise<string> {
	return mkdtemp(join(tmpdir(), "ug-io-"));
}

async function writeRawPlan(repoRoot: string, plan: UlwLoopPlan): Promise<void> {
	await mkdir(ulwLoopDir(repoRoot), { recursive: true });
	await writeFile(ulwLoopGoalsPath(repoRoot), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

async function readLedgerLines(repoRoot: string): Promise<string[]> {
	const raw = await readFile(ulwLoopLedgerPath(repoRoot), "utf8");
	return raw.split(/\r?\n/).filter(Boolean);
}

describe("readUlwLoopPlan", () => {
	let repoRoot = "";

	beforeEach(async () => {
		// given
		repoRoot = await makeRepo();
	});

	it("throws UlwLoopError when goals.json is missing", async () => {
		// when/then
		await expect(readUlwLoopPlan(repoRoot)).rejects.toThrow(UlwLoopError);
		await expect(readUlwLoopPlan(repoRoot)).rejects.toThrow("omo ulw-loop create-goals");
	});

	it("returns parsed plan when fixture is present", async () => {
		// given
		await mkdir(ulwLoopDir(repoRoot), { recursive: true });
		await copyFile(join(process.cwd(), "test", "fixtures", "sample-plan.json"), ulwLoopGoalsPath(repoRoot));

		// when
		const plan = await readUlwLoopPlan(repoRoot);

		// then
		expect(plan.version).toBe(1);
		expect(plan.codexGoalMode).toBe("aggregate");
		expect(plan.goals).toHaveLength(3);
		expect(plan.goals[0]?.successCriteria).toHaveLength(3);
	});

	it("migrates legacy aggregate objective on read + writes aggregate_objective_migrated ledger entry + retains alias", async () => {
		// given
		const legacyObjective = "Complete all ulw-loop stories in .omo/ulw-loop/goals.json: G001 Build auth service";
		await writeRawPlan(repoRoot, makePlan({ codexObjective: legacyObjective }));

		// when
		const plan = await readUlwLoopPlan(repoRoot);

		// then
		expect(plan.codexObjective).toBe(STABLE_OBJECTIVE);
		expect(plan.codexObjectiveAliases).toContain(legacyObjective);
		const persisted = JSON.parse(await readFile(ulwLoopGoalsPath(repoRoot), "utf8"));
		expect(persisted).toMatchObject({ codexObjective: STABLE_OBJECTIVE, codexObjectiveAliases: [legacyObjective] });
		const lines = await readLedgerLines(repoRoot);
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
			kind: "aggregate_objective_migrated",
			before: { codexObjective: legacyObjective },
		});
	});
});

describe("writePlan", () => {
	it("writes goals.json atomically with no temp file left behind", async () => {
		// given
		const repoRoot = await makeRepo();

		// when
		await writePlan(repoRoot, makePlan());

		// then
		const raw = await readFile(ulwLoopGoalsPath(repoRoot), "utf8");
		expect(JSON.parse(raw)).toMatchObject({ version: 1, goals: [{ id: "G001" }] });
		expect((await readdir(ulwLoopDir(repoRoot))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	it("overwrites existing file", async () => {
		// given
		const repoRoot = await makeRepo();
		await writePlan(repoRoot, makePlan({ codexObjective: "first" }));

		// when
		await writePlan(repoRoot, makePlan({ codexObjective: "second" }));

		// then
		expect(JSON.parse(await readFile(ulwLoopGoalsPath(repoRoot), "utf8"))).toMatchObject({
			codexObjective: "second",
		});
	});
});

describe("appendLedger", () => {
	it("appends a single JSONL line to ledger.jsonl", async () => {
		// given
		const repoRoot = await makeRepo();
		const ledgerEntry = entry("goal_started");

		// when
		await appendLedger(repoRoot, ledgerEntry);

		// then
		expect(await readLedgerLines(repoRoot)).toEqual([JSON.stringify(ledgerEntry)]);
	});

	it("creates ledger.jsonl if missing", async () => {
		// given
		const repoRoot = await makeRepo();

		// when
		await appendLedger(repoRoot, entry("goal_completed"));

		// then
		expect(await readFile(ulwLoopLedgerPath(repoRoot), "utf8")).toContain("goal_completed");
	});

	it("preserves prior entries", async () => {
		// given
		const repoRoot = await makeRepo();
		const first = entry("goal_started");
		const second = entry("goal_completed");

		// when
		await appendLedger(repoRoot, first);
		await appendLedger(repoRoot, second);

		// then
		expect(await readLedgerLines(repoRoot)).toEqual([JSON.stringify(first), JSON.stringify(second)]);
	});
});

describe("readSteeringLedgerEntries", () => {
	it("returns only steering-related event kinds", async () => {
		// given
		const repoRoot = await makeRepo();
		await appendLedger(repoRoot, entry("steering_accepted"));
		await appendLedger(repoRoot, entry("goal_started"));
		await appendLedger(repoRoot, entry("steering_rejected"));
		await appendLedger(repoRoot, entry("criteria_revised"));

		// when
		const entries = await readSteeringLedgerEntries(repoRoot);

		// then
		expect(entries.map((item) => item.kind)).toEqual(["steering_accepted", "steering_rejected", "criteria_revised"]);
	});

	it("returns empty array when ledger missing", async () => {
		// given
		const repoRoot = await makeRepo();

		// when/then
		await expect(readSteeringLedgerEntries(repoRoot)).resolves.toEqual([]);
	});
});

describe("findAcceptedSteeringLedgerEntry", () => {
	it.each([
		[
			"top-level idempotencyKey",
			steeringEntry("steering_accepted", steeringAudit(), { idempotencyKey: "needle-key" }),
		],
		["steering.idempotencyKey", steeringEntry("steering_accepted", steeringAudit({ idempotencyKey: "needle-key" }))],
		[
			"steering.promptSignature",
			steeringEntry("steering_accepted", steeringAudit({ promptSignature: "needle-key" })),
		],
	] as const)("finds an accepted entry by %s", async (_name, target) => {
		// given
		const repoRoot = await makeRepo();
		await appendLedger(repoRoot, steeringEntry("steering_accepted", steeringAudit({ idempotencyKey: "other-key" })));
		await appendLedger(repoRoot, target);

		// when
		const found = await findAcceptedSteeringLedgerEntry(repoRoot, "needle-key");

		// then
		expect(found).toEqual(target);
	});

	it("skips a rejected entry carrying the same key", async () => {
		// given
		const repoRoot = await makeRepo();
		await appendLedger(
			repoRoot,
			steeringEntry("steering_rejected", rejectedSteeringAudit({ idempotencyKey: "needle-key" })),
		);

		// when/then
		await expect(findAcceptedSteeringLedgerEntry(repoRoot, "needle-key")).resolves.toBeUndefined();
	});

	it("returns the accepted entry even when a rejected one with the same key precedes it", async () => {
		// given
		const repoRoot = await makeRepo();
		const accepted = steeringEntry("steering_accepted", steeringAudit({ idempotencyKey: "needle-key" }));
		await appendLedger(
			repoRoot,
			steeringEntry("steering_rejected", rejectedSteeringAudit({ idempotencyKey: "needle-key" })),
		);
		await appendLedger(repoRoot, accepted);

		// when/then
		await expect(findAcceptedSteeringLedgerEntry(repoRoot, "needle-key")).resolves.toEqual(accepted);
	});

	it("returns undefined when the ledger file is missing", async () => {
		// given
		const repoRoot = await makeRepo();

		// when/then
		await expect(findAcceptedSteeringLedgerEntry(repoRoot, "needle-key")).resolves.toBeUndefined();
	});

	it("ignores the key when it only appears in non-steering entries", async () => {
		// given
		const repoRoot = await makeRepo();
		await appendLedger(repoRoot, { at: NOW, kind: "goal_completed", goalId: "G001", idempotencyKey: "needle-key" });
		await appendLedger(repoRoot, { at: NOW, kind: "evidence_captured", goalId: "G001", evidence: "needle-key" });

		// when/then
		await expect(findAcceptedSteeringLedgerEntry(repoRoot, "needle-key")).resolves.toBeUndefined();
	});

	it("ignores an accepted entry whose key only appears in evidence text", async () => {
		// given
		const repoRoot = await makeRepo();
		await appendLedger(repoRoot, steeringEntry("steering_accepted", steeringAudit({ evidence: "needle-key" })));

		// when/then
		await expect(findAcceptedSteeringLedgerEntry(repoRoot, "needle-key")).resolves.toBeUndefined();
	});

	it("finds the key inside a legacy entry embedding full before/after plans", async () => {
		// given
		const repoRoot = await makeRepo();
		const bulkyGoals = Array.from({ length: 20 }, (_, index) =>
			makeGoal({ id: `G${String(index + 1).padStart(3, "0")}`, objective: `evidence detail ${index} `.repeat(200) }),
		);
		const bulkyPlan = makePlan({ goals: bulkyGoals });
		const legacyLine = JSON.stringify({
			at: NOW,
			kind: "steering_accepted",
			goalId: "G001",
			idempotencyKey: "needle-key",
			before: bulkyPlan,
			after: bulkyPlan,
			steering: { ...steeringAudit({ idempotencyKey: "needle-key" }), before: bulkyPlan, after: bulkyPlan },
		});
		await mkdir(ulwLoopDir(repoRoot), { recursive: true });
		await appendFile(ulwLoopLedgerPath(repoRoot), `${legacyLine}\n`, "utf8");

		// when
		const found = await findAcceptedSteeringLedgerEntry(repoRoot, "needle-key");

		// then
		expect(legacyLine.length).toBeGreaterThan(100_000);
		expect(found?.kind).toBe("steering_accepted");
		expect(found?.idempotencyKey).toBe("needle-key");
	});
});

describe("withUlwLoopMutationLock", () => {
	it("serializes concurrent invocations", async () => {
		// given
		const repoRoot = await makeRepo();
		const counterPath = join(repoRoot, "counter.txt");
		let active = 0;
		let maxActive = 0;
		await writeFile(counterPath, "0", "utf8");

		// when
		await Promise.all(
			[1, 2, 3].map((_) =>
				withUlwLoopMutationLock(repoRoot, async () => {
					active += 1;
					maxActive = Math.max(maxActive, active);
					const current = Number(await readFile(counterPath, "utf8"));
					await Promise.resolve();
					await writeFile(counterPath, String(current + 1), "utf8");
					active -= 1;
				}),
			),
		);

		// then
		expect(maxActive).toBe(1);
		expect(await readFile(counterPath, "utf8")).toBe("3");
	});

	it("propagates the body rejection and keeps later calls working", async () => {
		// given
		const repoRoot = await makeRepo();

		// when
		const failure = withUlwLoopMutationLock(repoRoot, async () => {
			throw new Error("body exploded");
		});

		// then
		await expect(failure).rejects.toThrow("body exploded");
		await expect(withUlwLoopMutationLock(repoRoot, async () => "recovered")).resolves.toBe("recovered");
	});

	it("still serializes a second batch after the first batch's gate settles", async () => {
		// given
		const repoRoot = await makeRepo();
		let active = 0;
		let maxActive = 0;
		const body = async (): Promise<void> => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await tick();
			active -= 1;
		};

		// when
		await Promise.all([1, 2, 3].map(() => withUlwLoopMutationLock(repoRoot, body)));
		await tick();
		await Promise.all([1, 2].map(() => withUlwLoopMutationLock(repoRoot, body)));

		// then
		expect(maxActive).toBe(1);
	});

	it("keeps an in-flight successor locked when an earlier gate settles", async () => {
		// given
		const repoRoot = await makeRepo();
		const events: string[] = [];
		let releaseSecond = false;

		// when
		const first = withUlwLoopMutationLock(repoRoot, async () => {
			events.push("first");
		});
		const second = withUlwLoopMutationLock(repoRoot, async () => {
			events.push("second:start");
			while (!releaseSecond) await tick();
			events.push("second:end");
		});
		await first;
		await tick();
		const third = withUlwLoopMutationLock(repoRoot, async () => {
			events.push("third");
		});
		releaseSecond = true;
		await Promise.all([second, third]);

		// then
		expect(events).toEqual(["first", "second:start", "second:end", "third"]);
	});

	it("does not serialize distinct repo roots against each other", async () => {
		// given
		const rootA = await makeRepo();
		const rootB = await makeRepo();
		const events: string[] = [];
		let releaseA = false;

		// when
		const held = withUlwLoopMutationLock(rootA, async () => {
			events.push("a:start");
			while (!releaseA) await tick();
			events.push("a:end");
		});
		await withUlwLoopMutationLock(rootB, async () => {
			events.push("b");
		});
		releaseA = true;
		await held;

		// then
		expect(events).toEqual(["a:start", "b", "a:end"]);
	});

	it("serializes per scope while distinct scopes stay independent", async () => {
		// given
		const repoRoot = await makeRepo();
		const scoped = { sessionId: "session-a" };
		const events: string[] = [];
		let releaseScoped = false;

		// when
		const heldScoped = withUlwLoopMutationLock(repoRoot, scoped, async () => {
			events.push("scoped-1:start");
			while (!releaseScoped) await tick();
			events.push("scoped-1:end");
		});
		const queuedScoped = withUlwLoopMutationLock(repoRoot, scoped, async () => {
			events.push("scoped-2");
		});
		await withUlwLoopMutationLock(repoRoot, async () => {
			events.push("root-scope");
		});
		releaseScoped = true;
		await Promise.all([heldScoped, queuedScoped]);

		// then
		expect(events).toEqual(["scoped-1:start", "root-scope", "scoped-1:end", "scoped-2"]);
	});
});
