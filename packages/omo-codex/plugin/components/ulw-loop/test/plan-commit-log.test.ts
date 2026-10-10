import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ulwLoopDir } from "../src/paths.js";
import { createUlwLoopPlan } from "../src/plan-crud.js";
import * as io from "../src/plan-io.js";
import { childWriter, cleanupWriters } from "./fixtures/commit-child.js";
import { seedCrash } from "./fixtures/commit-crash.js";
import { leaseClock } from "./fixtures/lease-clock.js";

let root: string;
let dir: string;
const scope = { sessionId: "commit-log" };
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ulw-commit-"));
	dir = ulwLoopDir(root, scope);
});
afterEach(async () => {
	await cleanupWriters();
	await rm(root, { recursive: true, force: true });
});
function snapshot() {
	return Object.fromEntries(
		["goals.json", "ledger.jsonl", "brief.md"].map((name) => [
			name,
			existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null,
		]),
	);
}

describe("#given an immutable plan and audit log", () => {
	it("#when (7a) a writer dies after publishing #then reads reconcile without writes and locked reads repair views", async () => {
		const next = await seedCrash(root, scope, false);
		const before = snapshot();
		expect(await io.readUlwLoopPlan(root, scope)).toEqual(next);
		expect(io.readLedger(root, scope).at(-1)?.id).toBe(`${next.revision}-0`);
		expect(snapshot()).toEqual(before);
		await io.withUlwLoopMutationLock(root, scope, () => io.readUlwLoopPlan(root, scope));
		expect(JSON.parse(readFileSync(join(dir, "goals.json"), "utf8"))).toEqual(next);
		expect(readFileSync(join(dir, "brief.md"), "utf8")).toBe(next.brief);
	});
	it("#when (7b) first creation has no goals cache #then existence and reads use the log", async () => {
		const next = await seedCrash(root, scope, true);
		expect(io.planExists(root, scope)).toBe(true);
		expect(await io.readUlwLoopPlan(root, scope)).toEqual(next);
	});
	it("#when (8) a legacy plan first commits #then revision zero and legacy ledger and brief survive", async () => {
		const plan = await createUlwLoopPlan(root, { brief: "legacy" }, scope);
		delete plan.revision;
		delete plan.brief;
		delete plan.ledgerResetRevision;
		await rm(join(dir, "revisions"), { recursive: true, force: true });
		writeFileSync(join(dir, "goals.json"), JSON.stringify(plan));
		writeFileSync(join(dir, "ledger.jsonl"), '{"at":"legacy","kind":"goal_started"}\n{"torn":');
		expect(io.readLedger(root, scope)[0]).toMatchObject({ revision: 0, id: "legacy-1" });
		const { commit } = await import("../src/plan-commit.js");
		await io.withUlwLoopMutationLock(root, scope, async () => {
			const legacy = await io.readUlwLoopPlan(root, scope);
			await commit(root, scope, { plan: legacy, entries: [] });
		});
		expect(readdirSync(join(dir, "revisions"))).toEqual(["00000001.json"]);
		expect(io.readLedger(root, scope)[0]?.id).toBe("legacy-1");
		expect(readFileSync(join(dir, "brief.md"), "utf8")).toBe("legacy\n");
	});
	it("#when (9) force recreation succeeds #then the reset is a new revision with filtered views", async () => {
		const first = await createUlwLoopPlan(root, { brief: "old" }, scope);
		const next = await createUlwLoopPlan(root, { brief: "new", force: true }, scope);
		expect(next.revision).toBe((first.revision ?? 0) + 1);
		expect(next.ledgerResetRevision).toBe(next.revision);
		expect(io.readLedger(root, scope)).toHaveLength(1);
		expect(readFileSync(join(dir, "brief.md"), "utf8")).toBe(next.brief);
		expect(readdirSync(join(dir, "revisions"))).toHaveLength(2);
	});
	it("#when (12) hard links are unsupported #then publication fails closed without a record or view changes", async () => {
		await createUlwLoopPlan(root, { brief: "old" }, scope);
		const before = snapshot();
		const { withCommitHooks, commit } = await import("../src/plan-commit.js");
		await expect(
			withCommitHooks(
				{
					link: () => {
						throw Object.assign(new Error("unsupported"), { code: "EPERM" });
					},
				},
				() =>
					io.withUlwLoopMutationLock(root, scope, async () => {
						const plan = await io.readUlwLoopPlan(root, scope);
						plan.brief = "forbidden";
						await commit(root, scope, { plan, entries: [] });
					}),
			),
		).rejects.toMatchObject({ code: "ULW_LOOP_PUBLISH_UNSUPPORTED_FS" });
		expect(snapshot()).toEqual(before);
		expect(readdirSync(join(dir, "revisions"))).toHaveLength(1);
	});
});

describe("#given paused writers in separate processes", () => {
	it.each(["write", "force"])(
		"#when (5)/(9) B wins %s after A's precheck #then A loses without publishing or changing views",
		async (mode) => {
			await createUlwLoopPlan(root, { brief: "initial" }, scope);
			const { withCommitHooks, commit } = await import("../src/plan-commit.js");
			let successor: ReturnType<typeof snapshot> | undefined;
			let writes = 0;
			const clock = leaseClock();
			await expect(
				withCommitHooks(
					{
						beforeCommit: async () => {
							clock.advance(201);
							const writer = childWriter(root, mode, clock.now());
							expect(await writer.exited).toBe(0);
							successor = snapshot();
						},
						writeView: async () => {
							writes += 1;
							throw new Error("loser wrote a view");
						},
					},
					() =>
						io.withUlwLoopMutationLock(
							root,
							scope,
							async () => {
								const plan = await io.readUlwLoopPlan(root, scope);
								plan.brief = "A\n";
								await commit(root, scope, { plan, entries: [{ at: "A", kind: "goal_added", message: "A" }] });
							},
							{ clock, leaseMs: 200, heartbeatMs: 0 },
						),
				),
			).rejects.toMatchObject({ code: "ULW_LOOP_LOCK_LOST" });
			expect(writes).toBe(0);
			expect(snapshot()).toEqual(successor);
			const published = JSON.parse(readFileSync(join(dir, "revisions", "00000002.json"), "utf8"));
			expect(published.plan).toEqual(await io.readUlwLoopPlan(root, scope));
			expect(published.ledger).toHaveLength(1);
			expect(io.readLedger(root, scope).at(-1)).toEqual(published.ledger[0]);
			expect(published.ledger[0].kind).toBe(mode === "force" ? "plan_created" : "goal_added");
			expect(io.readLedger(root, scope).some((entry) => entry.message === "A")).toBe(false);
			expect(readdirSync(join(dir, "revisions"))).toEqual(["00000001.json", "00000002.json"]);
		},
	);
	it("#when (6) A wins before the valid holder B #then B retries once from A's revision", async () => {
		await createUlwLoopPlan(root, { brief: "initial" }, scope);
		const { withCommitHooks, commit } = await import("../src/plan-commit.js");
		let writer: ReturnType<typeof childWriter> | undefined;
		const clock = leaseClock();
		await withCommitHooks(
			{
				beforeCommit: async () => {
					clock.advance(201);
					writer = childWriter(root, "mirror", clock.now());
					await writer.wait("before");
				},
			},
			() =>
				io.withUlwLoopMutationLock(
					root,
					scope,
					async () => {
						const plan = await io.readUlwLoopPlan(root, scope);
						plan.codexObjective = "A";
						await commit(root, scope, { plan, entries: [{ at: "A", kind: "goal_added", message: "A" }] });
					},
					{ clock, leaseMs: 200, heartbeatMs: 0 },
				),
		);
		if (writer === undefined) throw new Error("B not started");
		writer.child.send("resume");
		expect(await writer.exited).toBe(0);
		expect((await io.readUlwLoopPlan(root, scope)).codexObjective).toBe("A|B");
		expect(
			io
				.readLedger(root, scope)
				.slice(-2)
				.map((entry) => entry.message),
		).toEqual(["A", "B"]);
		expect(readdirSync(join(dir, "revisions"))).toHaveLength(3);
	});
	it("#when (7c) a child dies after an acknowledged partial temp write #then every public view remains complete", async () => {
		await createUlwLoopPlan(root, { brief: "initial" }, scope);
		const before = snapshot();
		const writer = childWriter(root, "partial");
		await writer.wait("partial");
		writer.child.kill("SIGKILL");
		await writer.exited;
		const after = snapshot();
		const published = JSON.parse(readFileSync(join(dir, "revisions", "00000002.json"), "utf8"));
		expect([before["goals.json"], `${JSON.stringify(published.plan, null, 2)}\n`]).toContain(after["goals.json"]);
		expect([before["brief.md"], published.plan.brief]).toContain(after["brief.md"]);
		expect(after["ledger.jsonl"]).toBe(before["ledger.jsonl"]);
		for (const line of readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n"))
			expect(() => JSON.parse(line)).not.toThrow();
		expect(io.readLedger(root, scope).at(-1)?.message).toBe("B");
	});
	it.each(["accepted", "rejected"])(
		"#when (11) %s steering dies after link #then its audit survives and accepted retries dedupe",
		async (mode) => {
			const original = await createUlwLoopPlan(root, { brief: "initial" }, scope);
			const writer = childWriter(root, mode);
			await writer.wait("linked");
			writer.child.kill("SIGKILL");
			await writer.exited;
			expect(io.readLedger(root, scope).at(-1)?.kind).toBe(`steering_${mode}`);
			const prior = await io.findAcceptedSteeringLedgerEntry(root, "crash-key", scope);
			if (mode === "rejected") {
				expect(prior).toBeUndefined();
				expect(await io.readUlwLoopPlan(root, scope)).toEqual({ ...original, revision: 2 });
			} else {
				const { steerUlwLoop } = await import("../src/steering.js");
				const result = await steerUlwLoop(
					root,
					{
						kind: "annotate_ledger",
						source: "cli",
						evidence: "observed",
						rationale: "audit",
						idempotencyKey: "crash-key",
					},
					scope,
				);
				expect(result.deduped).toBe(true);
				expect(io.readLedger(root, scope)).toHaveLength(2);
				expect(readdirSync(join(dir, "revisions"))).toHaveLength(2);
			}
		},
	);
	it("#when (10) retry fails before commit #then no goal_retried audit escapes", async () => {
		const { startNextUlwLoop } = await import("../src/plan-crud.js");
		const plan = await createUlwLoopPlan(root, { brief: "initial" }, scope);
		const { commit, withCommitHooks } = await import("../src/plan-commit.js");
		for (const goal of plan.goals) goal.status = "failed";
		await commit(root, scope, { plan, entries: [] });
		const before = snapshot();
		await expect(
			withCommitHooks(
				{
					beforeCommit: () => {
						throw new Error("stop before commit");
					},
				},
				() => startNextUlwLoop(root, { retryFailed: true }, scope),
			),
		).rejects.toThrow("stop before commit");
		expect(snapshot()).toEqual(before);
		expect(io.readLedger(root, scope).some((entry) => entry.kind === "goal_retried")).toBe(false);
	});
});
